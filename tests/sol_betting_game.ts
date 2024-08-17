import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import * as Token from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { SolBettingGame } from "../target/types/sol_betting_game";

describe("sol_betting_game", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolBettingGame as Program<SolBettingGame>;
  let mint: PublicKey;
  let vaultAccount: PublicKey;
  let _vaultBump: number;
  let roundInfo: PublicKey;
  let winners: PublicKey;
  let winnersVault: PublicKey;
  let _winnersVaultBump: number;
  let config: PublicKey;
  let owner: Keypair;
  let players: Keypair[] = [];
  let playerTokenAccounts: PublicKey[] = [];
  let configAccount: Keypair;
  let roundInfoAccount: Keypair;
  let winnersAccount: Keypair;

  before(async () => {
    // Создаём аккаунт владельца
    owner = Keypair.generate();
    const airdropSignature = await provider.connection.requestAirdrop(owner.publicKey, 100 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSignature);

    // Создаём аккаунты игроков и делаем им airdrop
    for (let i = 0; i < 3; i++) {
      const player = Keypair.generate();
      players.push(player);
      const airdropSignature = await provider.connection.requestAirdrop(player.publicKey, 100 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(airdropSignature);
    }

    // Создаём токен mint
    mint = await Token.createMint(
      provider.connection,
      owner,
      owner.publicKey,
      null,
      9,
    );
    console.log("Mint: ", mint.toString());

    // Создаём токен-аккаунты для игроков
    for (let player of players) {
      const tokenAccount = await Token.getOrCreateAssociatedTokenAccount(
        provider.connection,
        owner,
        mint,
        player.publicKey
      );
      await Token.mintTo(provider.connection, owner, mint, tokenAccount.address, owner.publicKey, 10000 * LAMPORTS_PER_SOL);
      playerTokenAccounts.push(tokenAccount.address);
    }
    console.log("Player token accounts: ", playerTokenAccounts);

    // Инициализируем контракт
    [vaultAccount, _vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_account")],
      program.programId
    );
    console.log("Vault account: ", vaultAccount.toString());

    [winnersVault, _winnersVaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("winners_vault")],
      program.programId
    );
    console.log("Winners Vault account: ", winnersVault.toString());

    configAccount = Keypair.generate();
    roundInfoAccount = Keypair.generate();
    winnersAccount = Keypair.generate(); // Аккаунт для хранения данных о победителях
    config = configAccount.publicKey;
    roundInfo = roundInfoAccount.publicKey;
    winners = winnersAccount.publicKey;
    console.log("Config account: ", configAccount.publicKey.toString());
    console.log("Round info account: ", roundInfoAccount.publicKey.toString());
    console.log("Winners account: ", winners.toString());

    const init_tx = await program.methods
      .initialize(owner.publicKey)
      .accounts({
        roundInfo: roundInfo,
        config: config,
        winners: winners, // Аккаунт для хранения данных о победителях
        owner: owner.publicKey,
        winnersVault: winnersVault, // PDA для хранения токенов победителей
        vaultAccount: vaultAccount,
        mint: mint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([roundInfoAccount, configAccount, winnersAccount, owner])
      .rpc();

    console.log("tx:", init_tx);
  });

  it("allows a player 0 to deposit tokens into the vault", async () => {
    const amount = 100 * LAMPORTS_PER_SOL;
    const player = players[0];
    console.log("player 0 balance: ", (await provider.connection.getBalance(player.publicKey)).toString());
    const playerTokenAccount = playerTokenAccounts[0];

    await program.methods
      .deposit(_vaultBump, new anchor.BN(amount))
      .accounts({
        vaultAccount: vaultAccount,
        roundInfo: roundInfo,
        user: player.publicKey,
        userTokenAccount: playerTokenAccount,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();

    const roundInfoData = await program.account.roundInfo.fetch(roundInfo);
    assert.equal(roundInfoData.totalDeposits.toString(), amount.toString());
  });

  it("allows a player 1 to deposit tokens into the vault", async () => {
    const amount = 202 * LAMPORTS_PER_SOL;
    const player = players[1];
    console.log("player 1 balance: ", (await provider.connection.getBalance(player.publicKey)).toString());
    const playerTokenAccount = playerTokenAccounts[1];

    await program.methods
      .deposit(_vaultBump, new anchor.BN(amount))
      .accounts({
        vaultAccount: vaultAccount,
        roundInfo: roundInfo,
        user: player.publicKey,
        userTokenAccount: playerTokenAccount,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();

    const roundInfoData = await program.account.roundInfo.fetch(roundInfo);
    assert.equal(roundInfoData.totalDeposits.toString(), (amount + 100 * LAMPORTS_PER_SOL).toString());
  });

  it("allows a player 2 to deposit tokens into the vault", async () => {
    const amount = 303 * LAMPORTS_PER_SOL;
    const player = players[2];
    console.log("player 2 balance: ", (await provider.connection.getBalance(player.publicKey)).toString());
    const playerTokenAccount = playerTokenAccounts[2];

    await program.methods
      .deposit(_vaultBump, new anchor.BN(amount))
      .accounts({
        vaultAccount: vaultAccount,
        roundInfo: roundInfo,
        user: player.publicKey,
        userTokenAccount: playerTokenAccount,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();

    const roundInfoData = await program.account.roundInfo.fetch(roundInfo);
    assert.equal(roundInfoData.totalDeposits.toString(), (amount + 302 * LAMPORTS_PER_SOL).toString());
  });

  it("draws a winner and distributes the prize", async () => {
    console.log("winner ", players[0].publicKey.toString());
    await program.methods
      .drawWinner(_vaultBump, players[0].publicKey) // Передаем публичный ключ победителя
      .accounts({
        config: config,
        roundInfo: roundInfo,
        vaultAccount: vaultAccount,
        winners: winners, // Передаем обычный аккаунт для данных победителей
        winnersVault: winnersVault, // PDA токенов победителей
        owner: owner.publicKey,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([ owner])
      .rpc();
  });

  it("allows the winner to claim their reward", async () => {
    const winner = players[0];
    const winnerTokenAccount = playerTokenAccounts[0];

    // Проверяем баланс победителя до получения приза
    const initialBalance = await Token.getAccount(provider.connection, winnerTokenAccount);
    console.log("Initial balance of winner's token account:", initialBalance.amount.toString());
    const winnersData = await program.account.winners.fetch(winners);
    console.log("Winners data: ", winnersData?.records);

    // Выполняем вызов метода claim_reward
    await program.methods
      .claimReward(_winnersVaultBump) // Используем bump для PDA
      .accounts({
        winners: winners,
        winnersVault: winnersVault, // PDA токенов победителей
        user: winner.publicKey,
        userTokenAccount: winnerTokenAccount, // Указываем аккаунт для получения токенов
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([winner])
      .rpc();

    // Проверяем баланс победителя после получения приза
    const finalBalance = await Token.getAccount(provider.connection, winnerTokenAccount);
    console.log("Final balance of winner's token account:", finalBalance.amount.toString());

    // Убеждаемся, что баланс увеличился на сумму приза
    const claimedPrizeAmount = finalBalance.amount - initialBalance.amount;
    console.log("Claimed prize amount:", claimedPrizeAmount.toString());

    assert.isTrue(claimedPrizeAmount > BigInt(0), "Prize should be successfully claimed.");
  });
});
