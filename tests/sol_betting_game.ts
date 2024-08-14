import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Connection,  } from '@solana/web3.js';
import { assert } from 'chai';
import { SolBettingGame } from '../target/types/sol_betting_game';

describe("sol-betting-game", () => {
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const program = anchor.workspace.SolBettingGame as Program<SolBettingGame>;

  const user1 = anchor.web3.Keypair.generate();
  const user2 = anchor.web3.Keypair.generate();
  const user3 = anchor.web3.Keypair.generate();

  let roundAccount: anchor.web3.Keypair;
  let configAccount: anchor.web3.Keypair;
  let winnerAccount: anchor.web3.Keypair;
  let winnerData: any;
  before(async () => {
    // Фандим тестовые кошельки
    const lamports = 1_000_000_000_000;
    const airdropPromises = [user1, user2, user3].map(async (user) =>
      await connection.requestAirdrop(user.publicKey, lamports)
    );

    const airdropSignatures = await Promise.all(airdropPromises);
    await Promise.all(airdropSignatures.map(async (sig) => await connection.confirmTransaction(sig)));

    console.log('Balances after airdrop:');
    console.log('User1:', await connection.getBalance(user1.publicKey));
    console.log('User2:', await connection.getBalance(user2.publicKey));
    console.log('User3:', await connection.getBalance(user3.publicKey));

    // Создаем аккаунты конфигурации и раунда
    roundAccount = anchor.web3.Keypair.generate();
    configAccount = anchor.web3.Keypair.generate();
    winnerAccount = anchor.web3.Keypair.generate();

    console.log(await program.methods
      .initialize()
      .accounts({
        config: configAccount.publicKey,
        round: roundAccount.publicKey,
        owner: user1.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([configAccount, roundAccount, user1])
      .rpc());

    console.log('Round and Config accounts initialized');
  });

  it('User1 makes a deposit', async () => {
    const depositAmount = 100_000_000_000;

    await program.methods
      .deposit(new anchor.BN(depositAmount))
      .accounts({
        round: roundAccount.publicKey,
        user: user1.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    const roundData = await program.account.roundInfo.fetch(roundAccount.publicKey);
    console.log('Total Deposits after User1 deposit:', roundData.totalDeposits.toNumber());

    assert.equal(roundData.totalDeposits.toNumber(), depositAmount, "Total deposits should match User1's deposit");
    assert.equal(roundData.deposits.length, 1, "Should have exactly one deposit record");
    assert.equal(roundData.deposits[0].amount.toNumber(), depositAmount, "User1's deposit should match the amount");
  });

  it('User2 makes a deposit', async () => {
    const depositAmount = 200_000_000_000;

    await program.methods
      .deposit(new anchor.BN(depositAmount))
      .accounts({
        round: roundAccount.publicKey,
        user: user2.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    const roundData = await program.account.roundInfo.fetch(roundAccount.publicKey);
    console.log('Total Deposits after User2 deposit:', roundData.totalDeposits.toNumber());

    assert.equal(roundData.totalDeposits.toNumber(), 300_000_000_000, "Total deposits should include both User1's and User2's deposits");
    assert.equal(roundData.deposits.length, 2, "Should have exactly two deposit records");
    assert.equal(roundData.deposits[1].amount.toNumber(), depositAmount, "User2's deposit should match the amount");
  });

  it('User1 makes another deposit', async () => {
    const additionalDepositAmount = 150_000_000_000;

    await program.methods
      .deposit(new anchor.BN(additionalDepositAmount))
      .accounts({
        round: roundAccount.publicKey,
        user: user1.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user1])
      .rpc();

    const roundData = await program.account.roundInfo.fetch(roundAccount.publicKey);
    console.log('Total Deposits after User1 makes another deposit:', roundData.totalDeposits.toNumber());

    const expectedTotal = 450_000_000_000; // 100_000_000_000 + 200_000_000_000 + 150_000_000_000
    const expectedUser1Deposit = 250_000_000_000; // 100_000_000_000 + 150_000_000_000

    assert.equal(roundData.totalDeposits.toNumber(), expectedTotal, "Total deposits should match all deposits");
    assert.equal(roundData.deposits.length, 2, "Should still have two deposit records, as User1's deposits are merged");
    assert.equal(roundData.deposits[0].amount.toNumber(), expectedUser1Deposit, "User1's total deposit should match the summed amount");
  });

  it('User3 makes a deposit', async () => {
    const depositAmount = 300_000_000_000;

    await program.methods
      .deposit(new anchor.BN(depositAmount))
      .accounts({
        round: roundAccount.publicKey,
        user: user3.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user3])
      .rpc();

    const roundData = await program.account.roundInfo.fetch(roundAccount.publicKey);
    console.log('Total Deposits after User3 deposit:', roundData.totalDeposits.toNumber());

    const expectedTotal = 750_000_000_000; // 450_000_000_000 + 300_000_000_000

    assert.equal(roundData.totalDeposits.toNumber(), expectedTotal, "Total deposits should include User3's deposit");
    assert.equal(roundData.deposits.length, 3, "Should have three deposit records");
    assert.equal(roundData.deposits[2].amount.toNumber(), depositAmount, "User3's deposit should match the amount");
  });

  it('Client determines the winner and invokes draw_winner', async () => {
    // Предположим, что клиент определил, что user2 является победителем
    const determinedWinner = user2.publicKey;
  
    // Вызываем draw_winner с определенным победителем
    await program.methods
      .drawWinner(determinedWinner)
      .accounts({
        config: configAccount.publicKey,
        round: roundAccount.publicKey,
        winner: winnerAccount.publicKey,
        owner: user1.publicKey,  // владелец контракта
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([winnerAccount, user1])
      .rpc();
  
    // Получаем данные победителя из аккаунта Winner
    const winnerData = await program.account.winner.fetch(winnerAccount.publicKey);
    console.log('Winner Pubkey:', winnerData.winner.toBase58());
    console.log('Prize Amount:', winnerData.amount.toNumber());
  
    // Проверяем, что победитель совпадает с определенным клиентом
    assert.equal(winnerData.winner.toBase58(), determinedWinner.toBase58(), "Winner should match the determined winner");
  
    // Проверяем баланс перед тем, как победитель забирает свой выигрыш
    const initialWinnerBalance = await connection.getBalance(determinedWinner);
    console.log('Initial Winner Balance:', initialWinnerBalance);
  
    // Победитель забирает свой выигрыш
    await program.methods
      .claimReward()
      .accounts({
        winner: winnerAccount.publicKey,
        claimant: determinedWinner,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user2])  // Убедитесь, что Signer соответствует определенному победителю
      .rpc();
  
    // Проверяем баланс после того, как победитель забрал свой выигрыш
    const finalWinnerBalance = await connection.getBalance(determinedWinner);
    console.log('Final Winner Balance:', finalWinnerBalance);
  
    const expectedBalance = initialWinnerBalance + winnerData.amount.toNumber();
  
    assert.equal(finalWinnerBalance, expectedBalance, "Winner's balance should increase by the prize amount");
    console.log("Winner has claimed their reward successfully");
  });
  
  
  
});
