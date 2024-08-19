use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("9VR2nRtwUNVR52HTqfWycxKUG1rfHtDnH16Xfqksyp72");

#[program]
pub mod sol_betting_game {
    use super::*;

    // Инициализация программы
    pub fn initialize(ctx: Context<Initialize>, owner: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.owner == Pubkey::default(), ErrorCode::AlreadyInitialized);
        require!(owner != Pubkey::default(), ErrorCode::Unauthorized);
        config.owner = *ctx.accounts.owner.key;
        config.current_round = 0;

        let round_info = &mut ctx.accounts.round_info;
        round_info.total_deposits = 0;
        round_info.is_round_open = true;

        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, _bump: u8, amount: u64) -> Result<()> {
        let round_info = &mut ctx.accounts.round_info;
    
        require!(round_info.is_round_open, ErrorCode::RoundClosed);
        require!(amount > 0, ErrorCode::InvalidDeposit);
    
        // Проверка переполнения
        let new_total_deposits = round_info.total_deposits.checked_add(amount).ok_or(ErrorCode::Overflow)?;
    
        if let Some(index) = round_info.deposit_indices.iter().position(|x| x.depositor == *ctx.accounts.user.key) {
            let deposit_index = round_info.deposit_indices[index].index as usize;
            round_info.deposits[deposit_index].token_amount = round_info.deposits[deposit_index].token_amount.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        } else {
            let new_index = round_info.deposits.len();
            round_info.deposits.push(Tokens {
                depositor: *ctx.accounts.user.key,
                mint: ctx.accounts.mint.key(),
                token_amount: amount,
            });
            round_info.deposit_indices.push(DepositIndex {
                depositor: *ctx.accounts.user.key,
                index: new_index as u16,
            });
        }
    
        round_info.total_deposits = new_total_deposits;
    
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
    
        token::transfer(cpi_ctx, amount)?;
    
        Ok(())
    }
    

    pub fn draw_winner(ctx: Context<DrawWinner>, _bump: u8, winner_pubkey: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let round_info = &mut ctx.accounts.round_info;
        require!(config.owner == *ctx.accounts.owner.key, ErrorCode::Unauthorized);
        require!(round_info.is_round_open, ErrorCode::RoundClosed);
        require!(round_info.deposits.len() > 0, ErrorCode::NoDeposits);
    
        let prize = round_info.total_deposits;
    
        let winner_exists = round_info.deposits.iter().any(|deposit| deposit.depositor == winner_pubkey);
        require!(winner_exists, ErrorCode::InvalidWinner);
    
        let seeds = &[b"vault_account_vvv".as_ref(), &[_bump]];
        let signer_seeds = &[&seeds[..]];
        // Перевод токенов из vault_account в winners_vault
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault_account.to_account_info(),
                to: ctx.accounts.winners_vault.to_account_info(),
                authority: ctx.accounts.vault_account.to_account_info(),
            }, signer_seeds
        );
        token::transfer(cpi_ctx, prize)?;
    
        // Запись победителя и его приза в аккаунт winners
        if let Some(winner_record) = ctx.accounts.winners.records.iter_mut().find(|record| record.winner == winner_pubkey) {
            winner_record.amount.checked_add(prize).ok_or(ErrorCode::Overflow)?;
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
        
        // Проверяем, что игрок является победителем
        let winner_record = winners.records.iter().find(|record| record.winner == *user.key);
        require!(winner_record.is_some(), ErrorCode::NoPrize);
        
        let amount = winner_record.unwrap().amount;
        require!(amount > 0, ErrorCode::NoPrize);
        
        // Расчет 5% для владельца и 95% для пользователя
        let owner_share = amount * 5 / 100;
        let user_share = amount - owner_share;
        
        // Подготавливаем контекст для перевода токенов из winners_vault на аккаунт владельца
        let seeds = &[b"winners_vault_vvv".as_ref(), &[_bump]];
        let signer_seeds = &[&seeds[..]];
        
        let cpi_ctx_owner = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.winners_vault.to_account_info(),
                to: ctx.accounts.owner_token_account.to_account_info(), // Аккаунт владельца
                authority: ctx.accounts.winners_vault.to_account_info(), // PDA выступает authority
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx_owner, owner_share)?;
        
        // Подготавливаем контекст для перевода токенов из winners_vault на аккаунт игрока
        let cpi_ctx_user = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.winners_vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(), // Аккаунт игрока
                authority: ctx.accounts.winners_vault.to_account_info(), // PDA выступает authority
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx_user, user_share)?;
        
        // Удаляем запись о победителе после получения приза
        winners.records.retain(|record| record.winner != *user.key);
        
        Ok(())
    }
    

    pub fn admin_withdraw(ctx: Context<AdminWithdraw>, _bump: u8, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(config.owner == *ctx.accounts.owner.key, ErrorCode::Unauthorized);
    
        
        let seeds = &[b"winners_vault_vvv".as_ref(), &[_bump]];
        let signer_seeds = &[&seeds[..]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.winners_vault.to_account_info(),
                to: ctx.accounts.admin_account.to_account_info(),
                authority: ctx.accounts.winners_vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;
    
        Ok(())
    }

    pub fn change_owner(ctx: Context<ChangeOwner>, new_owner: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(config.owner == *ctx.accounts.current_owner.key, ErrorCode::Unauthorized);
        config.owner = new_owner;
        Ok(())
    }
}

// Аккаунты для инициализации программы
#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 4096,  // Размер под RoundInfo
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
        space = 4096,  // Пространство для хранения списка победителей
    )]
    pub winners: Account<'info, Winners>, // Аккаунт для хранения данных о победителях
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        seeds = [b"winners_vault_vvv"],
        bump,
        token::mint = mint,
        token::authority = winners_vault, // Указываем PDA как владельца
    )]
    pub winners_vault: Account<'info, TokenAccount>, // PDA токенов для хранения призов
    #[account(
        init,
        payer = owner,
        seeds = [b"vault_account_vvv"],
        bump,
        token::mint = mint,
        token::authority = vault_account,
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
        seeds = [b"vault_account_vvv"],
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
        seeds = [b"vault_account_vvv"],
        bump,
    )]
    pub vault_account: Account<'info, TokenAccount>, // PDA токенов для хранения депозита
    #[account(mut)]
    pub winners: Account<'info, Winners>, // Аккаунт для хранения данных о победителях
    #[account(
        mut,
        seeds = [b"winners_vault_vvv"],
        bump,
    )]
    pub winners_vault: Account<'info, TokenAccount>, // PDA токенов для выигрышей
    #[account(mut)]
    pub owner: Signer<'info>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimReward<'info> {
    #[account(mut)]
    pub winners: Account<'info, Winners>, // Аккаунт для хранения данных о победителях
    #[account(
        mut,
        seeds = [b"winners_vault_vvv"],
        bump,
    )]
    pub winners_vault: Account<'info, TokenAccount>, // PDA токенов для выигрышей
    #[account(mut)]
    pub user: Signer<'info>, // Игрок, который забирает приз
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>, // Аккаунт, на который будут переведены токены
    #[account(mut)]
    pub owner_token_account: Account<'info, TokenAccount>, // Аккаунт владельца для получения 5%
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminWithdraw<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"winners_vault_vvv"],
        bump,
    )]
    pub winners_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub admin_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ChangeOwner<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub current_owner: Signer<'info>,
}


// Структура конфигурации
#[account]
pub struct Config {
    pub owner: Pubkey,
    pub current_round: u16,
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
    pub index: u16,
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
    #[msg("The operation is paused.")]
    Paused,
    #[msg("Expected overflow error")]
    Overflow,
}
