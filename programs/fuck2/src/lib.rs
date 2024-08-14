use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
declare_id!("8FFkzD327EcqEViecB8eJC3JE4zDso3rq4UjeZSTwiNy");

#[program]
pub mod sol_betting_game {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.owner = *ctx.accounts.owner.key;
        config.current_round = 0;
        let round = &mut ctx.accounts.round;
        round.total_deposits = 0;
        round.is_round_open = true;
        Ok(())
    }

    pub fn deposit(ctx: Context<DepositContext>, amount: u64) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(round.is_round_open, ErrorCode::RoundClosed);
        require!(amount > 0, ErrorCode::InvalidDeposit);

        // Найти существующий депозит или создать новый
        if let Some(index) = round.deposit_indices.iter().position(|x| x.depositor == *ctx.accounts.user.key) {
            let deposit_index = round.deposit_indices[index].index as usize;
            round.deposits[deposit_index].amount += amount;
        } else {
            let new_index = round.deposits.len();
            round.deposits.push(Deposit {
                depositor: *ctx.accounts.user.key,
                amount,
            });
            round.deposit_indices.push(DepositIndex {
                depositor: *ctx.accounts.user.key,
                index: new_index as u64,
            });
        }

        // Обновить общую сумму депозитов
        round.total_deposits += amount;

        // Перевод средств с аккаунта пользователя на аккаунт раунда
        let transfer_instruction = system_instruction::transfer(
            &ctx.accounts.user.key,
            &ctx.accounts.round.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_instruction,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.round.to_account_info(),
            ],
        )?;

        Ok(())
    }

    pub fn draw_winner(ctx: Context<DrawWinner>, winner_pubkey: Pubkey) -> Result<()> {
        let config = &ctx.accounts.config;
        let round = &mut ctx.accounts.round;
    
        require!(config.owner == *ctx.accounts.owner.key, ErrorCode::Unauthorized);
        require!(round.is_round_open, ErrorCode::RoundClosed);
        require!(round.deposits.len() > 0, ErrorCode::NoDeposits);
    
        // Проверяем, что переданный победитель участвовал в раунде
        let winner_exists = round.deposits.iter().any(|deposit| deposit.depositor == winner_pubkey);
        require!(winner_exists, ErrorCode::InvalidWinner);
    
        let prize = round.total_deposits;
    
        // Сначала сохраняем информацию о победителе и призе в аккаунт Winner
        let winner_account = &mut ctx.accounts.winner;
        winner_account.winner = winner_pubkey;
        winner_account.amount = prize;
    
        // Затем обнуляем данные раунда
        round.total_deposits = 0;
        round.deposits.clear();
        round.deposit_indices.clear();
        round.is_round_open = true;
    
        // Наконец, переводим призовые средства с аккаунта RoundInfo на аккаунт Winner
        {
            let round_account_info = ctx.accounts.round.to_account_info();
            let winner_account_info = ctx.accounts.winner.to_account_info();
            **round_account_info.try_borrow_mut_lamports()? -= prize;
            **winner_account_info.try_borrow_mut_lamports()? += prize;
        }
    
        Ok(())
    }
    
    
    pub fn claim_reward(ctx: Context<ClaimReward>) -> Result<()> {
        // Сначала работаем с mutable заимствованием
        let prize;
        {
            let winner_account = &mut ctx.accounts.winner;
            require!(winner_account.winner == *ctx.accounts.claimant.key, ErrorCode::Unauthorized);
            require!(winner_account.amount > 0, ErrorCode::NoPrize);
    
            prize = winner_account.amount;
            winner_account.amount = 0; // сбрасываем приз после выдачи
        }
    
        // Теперь работаем с immutable заимствованием для перевода лампортов
        {
            let winner_account_info = ctx.accounts.winner.to_account_info();
            let claimant_account_info = ctx.accounts.claimant.to_account_info();
            **winner_account_info.try_borrow_mut_lamports()? -= prize;
            **claimant_account_info.try_borrow_mut_lamports()? += prize;
        }
    
        // Затем удаляем аккаунт победителя после выполнения всех операций
        ctx.accounts.winner.close(ctx.accounts.claimant.to_account_info())?;
    
        Ok(())
    }
    
    
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = owner, space = 8 + Config::MAX_SIZE)]
    pub config: Account<'info, Config>,
    #[account(init, payer = owner, space = 8 + RoundInfo::MAX_SIZE)]
    pub round: Account<'info, RoundInfo>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositContext<'info> {
    #[account(mut)]
    pub round: Account<'info, RoundInfo>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DrawWinner<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub round: Account<'info, RoundInfo>,
    #[account(init, payer = owner, space = 8 + Winner::MAX_SIZE)]
    pub winner: Account<'info, Winner>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct ClaimReward<'info> {
    #[account(mut)]
    pub winner: Account<'info, Winner>,
    #[account(mut)]
    pub claimant: Signer<'info>,
    pub system_program: Program<'info, System>,
}


#[account]
pub struct Config {
    pub owner: Pubkey,
    pub current_round: u64,
}

#[account]
pub struct RoundInfo {
    pub total_deposits: u64,
    pub is_round_open: bool,
    pub deposits: Vec<Deposit>,
    pub deposit_indices: Vec<DepositIndex>,
}

#[account]
pub struct Winner {
    pub winner: Pubkey,
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Deposit {
    pub depositor: Pubkey,
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DepositIndex {
    pub depositor: Pubkey,
    pub index: u64,
}

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
}


impl Config {
    const MAX_SIZE: usize = 32 + 8;
}

impl RoundInfo {
    const MAX_SIZE: usize = 8 + 1 + (32 + 8) * 100;
}

impl Winner {
    const MAX_SIZE: usize = 32 + 8;
}

