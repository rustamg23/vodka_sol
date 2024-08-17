use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("8FFkzD327EcqEViecB8eJC3JE4zDso3rq4UjeZSTwiNy");

#[program]
pub mod sol_betting_game {
    use super::*;

    // Инициализация программы
    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.owner == Pubkey::default(), ErrorCode::AlreadyInitialized);
        config.owner = *ctx.accounts.owner.key;
        config.current_round = 0;

        let round_info = &mut ctx.accounts.round_info;
        round_info.total_deposits = 0;
        round_info.is_round_open = true;

        Ok(())
    }

    // Депозит токенов в текущий раунд
    pub fn deposit(ctx: Context<Deposit>, _bump: u8, amount: u64) -> Result<()> {
        let round_info = &mut ctx.accounts.round_info;

        require!(round_info.is_round_open, ErrorCode::RoundClosed);
        require!(amount > 0, ErrorCode::InvalidDeposit);

        if let Some(index) = round_info.deposit_indices.iter().position(|x| x.depositor == *ctx.accounts.user.key) {
            let deposit_index = round_info.deposit_indices[index].index as usize;
            round_info.deposits[deposit_index].token_amount += amount;
        } else {
            let new_index = round_info.deposits.len();
            round_info.deposits.push(Tokens {
                depositor: *ctx.accounts.user.key,
                mint: ctx.accounts.mint.key(),
                token_amount: amount,
            });
            round_info.deposit_indices.push(DepositIndex {
                depositor: *ctx.accounts.user.key,
                index: new_index as u64,
            });
        }

        round_info.total_deposits += amount;

        token::transfer(
            ctx.accounts.into_transfer_to_vault_context(),
            amount,
        )?;

        Ok(())
    }

    pub fn draw_winner(ctx: Context<DrawWinner>, _bump: u8, winner_pubkey: Pubkey) -> Result<()> {
        let round_info = &mut ctx.accounts.round_info;
    
        require!(round_info.is_round_open, ErrorCode::RoundClosed);
        require!(round_info.deposits.len() > 0, ErrorCode::NoDeposits);
    
        let prize = round_info.total_deposits;
    
        let winner_exists = round_info.deposits.iter().any(|deposit| deposit.depositor == winner_pubkey);
        require!(winner_exists, ErrorCode::InvalidWinner);
    
        // Сохранение ссылок на необходимые аккаунты перед созданием CpiContext
        let vault_account_info = ctx.accounts.vault_account.to_account_info();
        let winners_vault_info = ctx.accounts.winners_vault.to_account_info().clone(); // Клонируем здесь
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let owner = ctx.accounts.owner.to_account_info();
        // Перевод токенов из vault_account в winners_vault
        let cpi_ctx = CpiContext::new(
            token_program_info,
            token::Transfer {
                from: vault_account_info,
                to: winners_vault_info.clone(), // Используем клон
                authority: owner,
            },
        );
        token::transfer(cpi_ctx, prize)?;
    
        // Запись победителя и его приза в аккаунт winners
        if let Some(winner_record) = ctx.accounts.winners.records.iter_mut().find(|record| record.winner == winner_pubkey) {
            winner_record.amount += prize;
        } else {
            ctx.accounts.winners.records.push(WinnerRecord {
                winner: winner_pubkey,
                amount: prize,
            });
        }
    
        // Сброс информации о текущем раунде
        round_info.total_deposits = 0;
        round_info.deposits.clear();
        round_info.deposits.shrink_to_fit();
        round_info.deposit_indices.clear();
        round_info.deposit_indices.shrink_to_fit();
        round_info.is_round_open = true;
    
        Ok(())
    }
    
    

    pub fn claim_reward(ctx: Context<ClaimReward>, _bump: u8) -> Result<()> {
        let winners = &mut ctx.accounts.winners;
        let user = &ctx.accounts.user;
    
        // Поиск записи о победителе
        let winner_record = winners.records.iter().find(|record| record.winner == *user.key);
        require!(winner_record.is_some(), ErrorCode::NoPrize);
    
        let amount = winner_record.unwrap().amount;
        require!(amount > 0, ErrorCode::NoPrize);
    
        // Сохранение ссылок на необходимые аккаунты перед созданием CpiContext
        let winners_vault_info = ctx.accounts.winners_vault.to_account_info().clone(); // Клонируем здесь
        let user_token_account_info = ctx.accounts.user_token_account.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
    
        // Перевод токенов победителю
        let cpi_ctx = CpiContext::new(
            token_program_info,
            token::Transfer {
                from: winners_vault_info.clone(), // Используем клон
                to: user_token_account_info,
                authority: winners_vault_info, // Используем клон
            },
        );
        token::transfer(cpi_ctx, amount)?;
    
        // Удаление записи о победителе
        winners.records.retain(|record| record.winner != *user.key);
    
        Ok(())
    }
    
    
}

// Контексты для инструкций
impl<'info> Deposit<'info> {
    fn into_transfer_to_vault_context(&self) -> CpiContext<'_, '_, '_, 'info, token::Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            token::Transfer {
                from: self.user_token_account.to_account_info(),
                to: self.vault_account.to_account_info(),
                authority: self.user.to_account_info(),
            },
        )
    }
}

impl<'info> DrawWinner<'info> {
    fn into_transfer_to_winners_vault_context(&self) -> CpiContext<'_, '_, '_, 'info, token::Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            token::Transfer {
                from: self.vault_account.to_account_info(),
                to: self.winners_vault.to_account_info(),
                authority: self.owner.to_account_info(),
            },
        )
    }
}

impl<'info> ClaimReward<'info> {
    fn into_transfer_to_user_context(&self) -> CpiContext<'_, '_, '_, 'info, token::Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            token::Transfer {
                from: self.winners_vault.to_account_info(),
                to: self.user_token_account.to_account_info(),
                authority: self.winners_vault.to_account_info(),
            },
        )
    }
}

// Аккаунты для инициализации программы
#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 8 + 4 + 400,  // Размер под RoundInfo
    )]
    pub round_info: Account<'info, RoundInfo>,
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 8,
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = owner,
        space = 8 + 4 + 400 * 10,  // Пространство для хранения списка победителей
    )]
    pub winners: Account<'info, Winners>, // Аккаунт для хранения данных о победителях
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        seeds = [b"winners_vault"],
        bump,
        token::mint = mint,
        token::authority = owner,
    )]
    pub winners_vault: Account<'info, TokenAccount>, // PDA токенов для хранения призов
    #[account(
        init,
        payer = owner,
        seeds = [b"vault_account"],
        bump,
        token::mint = mint,
        token::authority = owner,
    )]
    pub vault_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

// Аккаунты для депозита
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault_account"],
        bump
    )]
    pub vault_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub round_info: Account<'info, RoundInfo>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// Аккаунты для определения победителя
#[derive(Accounts)]
#[instruction(winner_pubkey: Pubkey)]
pub struct DrawWinner<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub round_info: Account<'info, RoundInfo>,
    #[account(
        mut,
        seeds = [b"vault_account"],
        bump,
    )]
    pub vault_account: Account<'info, TokenAccount>, // PDA токенов для хранения депозита
    #[account(mut)]
    pub winners: Account<'info, Winners>, // Аккаунт для хранения данных о победителях
    #[account(
        mut,
        seeds = [b"winners_vault"],
        bump,
    )]
    pub winners_vault: Account<'info, TokenAccount>, // PDA токенов для выигрышей
    #[account(mut)]
    pub owner: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// Аккаунты для получения приза победителем
#[derive(Accounts)]
pub struct ClaimReward<'info> {
    #[account(mut)]
    pub winners: Account<'info, Winners>, // Аккаунт для хранения данных о победителях
    #[account(
        mut,
        seeds = [b"winners_vault"],
        bump,
    )]
    pub winners_vault: Account<'info, TokenAccount>, // PDA токенов для выигрышей
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// Структура конфигурации
#[account]
pub struct Config {
    pub owner: Pubkey,
    pub current_round: u64,
}

// Структура для хранения информации о текущем раунде
#[account]
pub struct RoundInfo {
    pub deposits: Vec<Tokens>, // Информация о депозитах
    pub total_deposits: u64,
    pub is_round_open: bool,
    pub deposit_indices: Vec<DepositIndex>,
}

// Структура для хранения данных о победителях
#[account]
pub struct Winners {
    pub records: Vec<WinnerRecord>, // Список победителей и их призов
}

// Структура для хранения данных о победителе
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WinnerRecord {
    pub winner: Pubkey,
    pub amount: u64,
}

// Структура для хранения информации о депозитах
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Tokens {
    pub mint: Pubkey,
    pub token_amount: u64,
    pub depositor: Pubkey,
}

// Структура для хранения индексов депозитов
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DepositIndex {
    pub depositor: Pubkey,
    pub index: u64,
}

// Коды ошибок
#[error_code]
pub enum ErrorCode {
    #[msg("The round is currently closed.")]
    RoundClosed,
    #[msg("Invalid deposit amount.")]
    InvalidDeposit,
    #[msg("No deposits available in the round.")]
    NoDeposits,
    #[msg("Unauthorized.")]
    Unauthorized,
    #[msg("No prize available to claim.")]
    NoPrize,
    #[msg("The specified winner is invalid.")]
    InvalidWinner,
    #[msg("Already initialized.")]
    AlreadyInitialized,
}
