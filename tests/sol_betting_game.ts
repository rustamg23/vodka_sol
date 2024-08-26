import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import * as Token from "@solana/spl-token";
import { TOKEN_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { SolBettingGame } from "../target/types/sol_betting_game";

describe("sol_betting_game", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolBettingGame as Program<SolBettingGame>;
  let mint: PublicKey;
  let mintB: PublicKey;
  let vaultAccount: PublicKey;
  let _vaultBump: number;
  let roundInfo: PublicKey;
  let winners: PublicKey;
  let winnersVault: PublicKey;
  let _winnersVaultBump: number;
  let config: PublicKey;
  let owner: Keypair;
  let players: Keypair[] = [];
  let ownerTokenAccount: PublicKey;
  let ownerTokenBAccount: PublicKey;
  let playerTokenAccounts: PublicKey[] = [];
  let playerTokenBAccounts: PublicKey[] = [];
  let configAccount: Keypair;
  let roundInfoAccount: Keypair;
  let winnersAccount: Keypair;

  before(async () => {
    console.log("Создаём аккаунт владельца")
    owner = Keypair.generate();
    const airdropSignature = await provider.connection.requestAirdrop(owner.publicKey, 100 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSignature);
  
    console.log("Проверка баланса владельца после airdrop")
    let ownerBalance = await provider.connection.getBalance(owner.publicKey);
    assert.isTrue(ownerBalance >= 100 * LAMPORTS_PER_SOL, "Owner's balance should be at least 100 SOL");
  
    console.log("Создаём аккаунты игроков и делаем им airdrop")
    for (let i = 0; i < 3; i++) {
      const player = Keypair.generate();
      players.push(player);
      const airdropSignature = await provider.connection.requestAirdrop(player.publicKey, 100 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(airdropSignature);
  
      // Проверка баланса игрока после airdrop
      let playerBalance = await provider.connection.getBalance(player.publicKey);
      assert.isTrue(playerBalance >= 100 * LAMPORTS_PER_SOL, `Player ${i}'s balance should be at least 100 SOL`);
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
    mintB = await Token.createMint(
      provider.connection,
      owner,
      owner.publicKey,
      null,
      9,
    )
    
  
    // Проверка свойств mint
    const mintInfo = await Token.getMint(provider.connection, mint);
    assert.equal(mintInfo.decimals, 9, "Mint should have 9 decimals");
    assert.equal(mintInfo.mintAuthority?.toString(), owner.publicKey.toString(), "Owner should be the mint authority");
    ownerTokenAccount = (await Token.getOrCreateAssociatedTokenAccount(
      provider.connection,
      owner,
      mint,
      owner.publicKey
    )).address

    ownerTokenBAccount = (await Token.getOrCreateAssociatedTokenAccount(
      provider.connection,
      owner,
      mintB,
      owner.publicKey
    )).address

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
      // Проверка баланса токен-аккаунта игрока после mint
      const tokenAccountInfo = await Token.getAccount(provider.connection, tokenAccount.address);
      assert.equal(tokenAccountInfo.amount.toString(), (10000 * LAMPORTS_PER_SOL).toString(), `Player's token account should have 10,000 tokens`);

      const tokenBAccount = await Token.getOrCreateAssociatedTokenAccount(
        provider.connection,
        owner,
        mintB,
        player.publicKey
      );
      await Token.mintTo(provider.connection, owner, mintB, tokenBAccount.address, owner.publicKey, 10000 * LAMPORTS_PER_SOL);
      playerTokenBAccounts.push(tokenBAccount.address);
      // Проверка баланса токен-аккаунта игрока после mint
      const tokenBAccountInfo = await Token.getAccount(provider.connection, tokenBAccount.address);
      assert.equal(tokenBAccountInfo.amount.toString(), (10000 * LAMPORTS_PER_SOL).toString(), `Player's token account should have 10,000 tokens`);

    }
    console.log("Player token accounts: ", playerTokenAccounts);
  
    // Инициализируем контракт
    [vaultAccount, _vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_account_v")],
      program.programId
    );
    console.log("Vault account: ", vaultAccount.toString());
  
    [winnersVault, _winnersVaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("winners_vault_v")],
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
  
    // Проверка инициализации roundInfo и config
    const roundInfoData = await program.account.roundInfo.fetch(roundInfo);
    assert.equal(roundInfoData.totalDeposits.toString(), "0", "Total deposits should be 0 after initialization");
    assert.isTrue(roundInfoData.isRoundOpen, "Round should be open after initialization");
  
    const configData = await program.account.config.fetch(config);
    assert.equal(configData.owner.toString(), owner.publicKey.toString(), "Config owner should be correctly set");
  
    // Проверка инициализации winners account
    const winnersData = await program.account.winners.fetch(winners);
    assert.equal(winnersData.records.length, 0, "Winners account should be empty after initialization");
  });

  async function makeDeposit(player: Keypair, amount: number) {
    const playerIndex = players.indexOf(player);
    const playerTokenAccount = playerTokenAccounts[playerIndex];
    
    console.log(`Player ${playerIndex} depositing ${amount/LAMPORTS_PER_SOL} tokens`);
  
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
  
    // Возвращаем данные roundInfo для проверки
    const roundInfoData = await program.account.roundInfo.fetch(roundInfo);
    return roundInfoData;
  }

  async function makeDeposiB(player: Keypair, amount: number) {
    const playerIndex = players.indexOf(player);
    const playerTokenBAccount = playerTokenBAccounts[playerIndex];
    
    console.log(`Player ${playerIndex} depositing ${amount} tokens`);
  
    await program.methods
      .deposit(_vaultBump, new anchor.BN(amount))
      .accounts({
        vaultAccount: vaultAccount,
        roundInfo: roundInfo,
        user: player.publicKey,
        userTokenAccount: playerTokenBAccount,
        mint: mintB,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();
  
    // Возвращаем данные roundInfo для проверки
    const roundInfoData = await program.account.roundInfo.fetch(roundInfo);
    return roundInfoData;
  }
  async function drawWinner(winner: Keypair) {
    await program.methods
      .flipRound()
      .accounts({
        config: config,
        roundInfo: roundInfo,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc()
    
    console.log("drawing winner and his prize is: ", parseInt((await Token.getAccount(provider.connection, vaultAccount)).amount.toString()) * 0.95/10**9);
    await program.methods
      .drawWinner(_vaultBump, winner.publicKey)
      .accounts({
        config: config,
        roundInfo: roundInfo,
        vaultAccount: vaultAccount,
        winners: winners,
        winnersVault: winnersVault,
        owner: owner.publicKey,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // Возвращаем данные winners для проверки
    const winnersData = await program.account.winners.fetch(winners);
    return winnersData;
  }

  async function drawWinnerB(winner: Keypair) {
    await program.methods
      .drawWinner(_vaultBump, winner.publicKey)
      .accounts({
        config: config,
        roundInfo: roundInfo,
        vaultAccount: vaultAccount,
        winners: winners,
        winnersVault: winnersVault,
        owner: owner.publicKey,
        mint: mintB,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
  
    // Возвращаем данные winners для проверки
    const winnersData = await program.account.winners.fetch(winners);
    return winnersData;
  }

  async function claimReward(winner: Keypair) {
    const playerIndex = players.indexOf(winner);
    const playerTokenAccount = playerTokenAccounts[playerIndex];
  
    await program.methods
      .claimReward(_winnersVaultBump)
      .accounts({
        winners: winners,
        winnersVault: winnersVault,
        user: winner.publicKey,
        userTokenAccount: playerTokenAccount,
        ownerTokenAccount: ownerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([winner])
      .rpc();
  
    // Возвращаем баланс победителя и данные winners для проверки
    const winnerTokenBalance = await Token.getAccount(provider.connection, playerTokenAccount);
    console.log("Claiming prize")
    const winnersData = await program.account.winners.fetch(winners);
    return { winnerTokenBalance, winnersData };
  }

  const printBalance = async (publicKey: any, name: string, when: string) => {
    const tokenAccount = await Token.getOrCreateAssociatedTokenAccount(
      provider.connection,
      owner,
      mint,
      publicKey,
      true,
    )
    const balance = await Token.getAccount(provider.connection, tokenAccount.address);
    console.log(`${name}'s token account balance ${when}: `, parseInt(balance.amount.toString())/10**9);
  };

  const printPDABalance = async (publicKey: any, name: string, when: string) => {
    const balance = await Token.getAccount(provider.connection, publicKey);
    console.log(`${name}'s token account balance ${when}: `, parseInt(balance.amount.toString())/10**9);
  };
  
  // describe("Deposits", () => {
  //   it("allows multiple players to deposit and tracks their deposits correctly", async () => {
  //     // Первый депозит от игрока 0
  //     const depositAmount1 = 100 * LAMPORTS_PER_SOL;
  //     let roundInfoData = await makeDeposit(players[0], depositAmount1);
  //     assert.equal(roundInfoData.totalDeposits.toString(), depositAmount1.toString(), "Total deposits should equal the first deposit amount");
  
  //     // Проверка, что запись о депозите игрока 0 есть в массиве deposits
  //     assert.equal(roundInfoData.deposits.length, 1, "There should be 1 deposit after the first player deposits");
  //     assert.equal(roundInfoData.deposits[0].depositor.toString(), players[0].publicKey.toString(), "The first deposit should be from player 0");
  //     assert.equal(roundInfoData.deposits[0].tokenAmount.toString(), depositAmount1.toString(), "Player 0's deposit should equal the deposit amount");
  
  //     // Второй депозит от игрока 1
  //     const depositAmount2 = 202 * LAMPORTS_PER_SOL;
  //     roundInfoData = await makeDeposit(players[1], depositAmount2);
  //     assert.equal(roundInfoData.totalDeposits.toString(), (depositAmount1 + depositAmount2).toString(), "Total deposits should be the sum of deposits 1 and 2");
  
  //     // Проверка, что запись о депозите игрока 1 добавлена
  //     assert.equal(roundInfoData.deposits.length, 2, "There should be 2 deposits after the second player deposits");
  //     assert.equal(roundInfoData.deposits[1].depositor.toString(), players[1].publicKey.toString(), "The second deposit should be from player 1");
  //     assert.equal(roundInfoData.deposits[1].tokenAmount.toString(), depositAmount2.toString(), "Player 1's deposit should equal the deposit amount");
  
  //     // Третий депозит от игрока 2
  //     const depositAmount3 = 303 * LAMPORTS_PER_SOL;
  //     roundInfoData = await makeDeposit(players[2], depositAmount3);
  //     assert.equal(roundInfoData.totalDeposits.toString(), (depositAmount1 + depositAmount2 + depositAmount3).toString(), "Total deposits should be the sum of all deposits");
  
  //     // Проверка, что запись о депозите игрока 2 добавлена
  //     assert.equal(roundInfoData.deposits.length, 3, "There should be 3 deposits after the third player deposits");
  //     assert.equal(roundInfoData.deposits[2].depositor.toString(), players[2].publicKey.toString(), "The third deposit should be from player 2");
  //     assert.equal(roundInfoData.deposits[2].tokenAmount.toString(), depositAmount3.toString(), "Player 2's deposit should equal the deposit amount");
  
  //     // Дополнительная проверка индексов депозитов
  //     assert.equal(roundInfoData.depositIndices.length, 3, "There should be 3 deposit indices corresponding to the 3 players");
  //     assert.equal(roundInfoData.depositIndices[0].depositor.toString(), players[0].publicKey.toString(), "First index should correspond to player 0");
  //     assert.equal(roundInfoData.depositIndices[1].depositor.toString(), players[1].publicKey.toString(), "Second index should correspond to player 1");
  //     assert.equal(roundInfoData.depositIndices[2].depositor.toString(), players[2].publicKey.toString(), "Third index should correspond to player 2");
      
  //     console.log("player 0 token balance: ", (await Token.getAccount(provider.connection, playerTokenAccounts[0])).amount.toString())
      
  //     await drawWinner(players[0])
  //     await claimReward(players[0])
  //     console.log("player 0 token balance: ", (await Token.getAccount(provider.connection, playerTokenAccounts[0])).amount.toString())
  //   });
  // });
  
  //   describe("Draw Winner", () => {
  //     before(async () => {
  //       // Убедимся, что выполнены депозиты перед вызовом draw_winner
  //       const depositAmount1 = 100 * LAMPORTS_PER_SOL;
  //       const depositAmount2 = 202 * LAMPORTS_PER_SOL;
  //       const depositAmount3 = 303 * LAMPORTS_PER_SOL;
    
  //       await makeDeposit(players[0], depositAmount1);
  //       await makeDeposit(players[1], depositAmount2);
  //       await makeDeposit(players[2], depositAmount3);
  //     });
    
  //     it("successfully draws a winner and transfers the prize", async () => {
  //       const initialVaultBalance = await Token.getAccount(provider.connection, vaultAccount);
  //       console.log("Initial vault balance:", initialVaultBalance.amount.toString());
    
  //       // Выбираем игрока 0 как победителя
  //       const winnersData = await drawWinner(players[0]);
    
  //       // Проверка, что игрок 0 записан в список победителей
  //       const winnerRecord = winnersData.records.find(record => record.winner.toString() === players[0].publicKey.toString());
  //       assert.isDefined(winnerRecord, "Winner record for player 0 should be defined");
  //       assert.equal(winnerRecord.amount.toString(), initialVaultBalance.amount.toString(), "Winner's prize amount should equal the vault balance");
    
  //       // Проверка баланса winners_vault
  //       const winnersVaultBalance = await Token.getAccount(provider.connection, winnersVault);
  //       console.log("Winners vault balance:", winnersVaultBalance.amount.toString());
  //       assert.equal(winnersVaultBalance.amount.toString(), initialVaultBalance.amount.toString(), "Winners vault balance should equal the transferred prize amount");
    
  //       // Проверка, что vault_account баланс обнулен
  //       const finalVaultBalance = await Token.getAccount(provider.connection, vaultAccount);
  //       assert.equal(finalVaultBalance.amount.toString(), "0", "Vault account balance should be 0 after drawing the winner");
  //     });
    
  //     it("fails to draw a winner when there are no deposits", async () => {
  //       try {
  //         // Попробуем вызвать draw_winner без депозитов
  //         await drawWinner(players[0]);
    
  //         // Если дошли сюда, значит ошибка не была выброшена
  //         assert.fail("Should fail when there are no deposits");
  //       } catch (err) {
  //         assert.equal(err.error.errorCode.code, "NoDeposits", "Error should be NoDeposits when trying to draw winner with no deposits");
  //       }
  //     });
    
  //     it("fails to draw a winner with an invalid winner address", async () => {
  //       try {
  //         const depositAmount1 = 100 * LAMPORTS_PER_SOL;
  //         const depositAmount2 = 202 * LAMPORTS_PER_SOL;
  //         const depositAmount3 = 303 * LAMPORTS_PER_SOL;
          
  //         await makeDeposit(players[0], depositAmount1);
  //         await makeDeposit(players[1], depositAmount2);
  //         await makeDeposit(players[2], depositAmount3);
  //         // Создадим нового игрока, который не делал депозитов
  //         const nonDepositor = Keypair.generate();
    
  //         // Попробуем указать его в качестве победителя
  //         await drawWinner(nonDepositor);
    
  //         // Если дошли сюда, значит ошибка не была выброшена
  //         assert.fail("Should fail when trying to draw an invalid winner");
  //       } catch (err) {
  //         assert.equal(err.error.errorCode.code, "InvalidWinner", "Error should be InvalidWinner when trying to draw an invalid winner");
  //       }
  //     });
  //   });
    

  //    describe("Claim Reward", () => {
  //      let winner: Keypair;
  //      let initialWinnerBalance: any;

  //      before(async () => {
  //        // Убедимся, что выполнены депозиты и определен победитель перед вызовом claim_reward
  //        const depositAmount1 = 100 * LAMPORTS_PER_SOL;
  //        const depositAmount2 = 202 * LAMPORTS_PER_SOL;
  //        const depositAmount3 = 303 * LAMPORTS_PER_SOL;

  //        await makeDeposit(players[0], depositAmount1);
  //        await makeDeposit(players[1], depositAmount2);
  //        await makeDeposit(players[2], depositAmount3);

  //        // Определяем игрока 0 как победителя
  //        winner = players[0];
  //        await drawWinner(winner);

  //        // Проверяем баланс победителя перед получением приза
  //        initialWinnerBalance = await Token.getAccount(provider.connection, playerTokenAccounts[0]);
  //        console.log("Initial winner's token account balance:", initialWinnerBalance.amount.toString());
  //      });

  //      it("allows the winner to claim their reward", async () => {
  //        // Получаем приз победителя
  //        const { winnerTokenBalance, winnersData } = await claimReward(winner);

  //        // Проверяем, что баланс победителя увеличился на сумму приза
  //        const prizeAmount = winnerTokenBalance.amount - initialWinnerBalance.amount;
  //        console.log("Prize amount claimed:", prizeAmount.toString());
  //        assert.isTrue(prizeAmount > BigInt(0), "Prize should be successfully claimed.");

  //        // Проверяем, что запись о победителе удалена из winners аккаунта
  //        assert.equal(winnersData.records.length, 0, "Winners account should be empty after prize is claimed.");
  //      });

  //      it("fails if a non-winner tries to claim a reward", async () => {
  //        try {
  //          // Попробуем вызвать claim_reward от имени игрока, который не выигрывал
  //          const nonWinner = players[1];
  //          await claimReward(nonWinner);

  //          // Если дошли сюда, значит ошибка не была выброшена
  //          assert.fail("Should fail when a non-winner tries to claim a reward");
  //        } catch (err) {
  //          assert.equal(err.error.errorCode.code, "NoPrize", "Error should be NoPrize when a non-winner tries to claim a reward");
  //        }
  //      });

  //      it("fails if trying to claim a reward that has already been claimed", async () => {
  //        try {
  //          // Попробуем снова получить приз уже после того, как он был получен
  //          await claimReward(winner);

  //          // Если дошли сюда, значит ошибка не была выброшена
  //          assert.fail("Should fail when trying to claim a reward that has already been claimed");
  //        } catch (err) {
  //          assert.equal(err.error.errorCode.code, "NoPrize", "Error should be NoPrize when trying to claim a reward that has already been claimed");
  //        }
  //      });
  //    })
  //    describe("Claim reward after several rounds", () => {
  //      before(async () => {
  //        // Первый раунд: игроки делают депозиты и определяем победителя
  //        const depositAmount1 = 100 * LAMPORTS_PER_SOL;
  //        const depositAmount2 = 202 * LAMPORTS_PER_SOL;
  //        await makeDeposit(players[0], depositAmount1);
  //        await makeDeposit(players[1], depositAmount2);

  //        // Игрок 0 выиграл первый раунд
  //        await drawWinner(players[0]);

  //        // Второй раунд: новый набор депозитов и новый победитель
  //        await makeDeposit(players[1], depositAmount2);
  //        await makeDeposit(players[2], depositAmount2);

  //        // Игрок 2 выиграл второй раунд
  //        await drawWinner(players[2]);

  //        // Третий раунд: депозиты снова, но без определения победителя
  //        await makeDeposit(players[0], depositAmount1);
  //        await makeDeposit(players[1], depositAmount2);
  //      });

  //      it("allows winners from multiple rounds to claim their rewards even after several rounds", async () => {
  //        // Игрок 0 получает свой приз
  //        const initialWinner0Balance = await Token.getAccount(provider.connection, playerTokenAccounts[0]);
  //        const { winnerTokenBalance: winner0TokenBalance } = await claimReward(players[0]);
  //        const prizeAmount0 = winner0TokenBalance.amount - initialWinner0Balance.amount;
  //        console.log("Player 0 prize amount claimed after several rounds:", prizeAmount0.toString());
  //        assert.isTrue(prizeAmount0 > BigInt(0), "Player 0 should be able to claim their prize after several rounds.");

  //        // Игрок 2 получает свой приз
  //        const initialWinner2Balance = await Token.getAccount(provider.connection, playerTokenAccounts[2]);
  //        const { winnerTokenBalance: winner2TokenBalance } = await claimReward(players[2]);
  //        const prizeAmount2 = winner2TokenBalance.amount - initialWinner2Balance.amount;
  //        console.log("Player 2 prize amount claimed after several rounds:", prizeAmount2.toString());
  //        assert.isTrue(prizeAmount2 > BigInt(0), "Player 2 should be able to claim their prize after several rounds.");
  //      });
  //    })
  //    describe("Deposit summation within a single round", () => {
  //      before(async () => {
  //        // Начнем новый раунд
  //        const depositAmount1 = 100 * LAMPORTS_PER_SOL;
  //        const depositAmount2 = 50 * LAMPORTS_PER_SOL;
  //        const depositAmount3 = 25 * LAMPORTS_PER_SOL;

  //        // Игрок 0 делает несколько депозитов в один раунд
  //        await makeDeposit(players[3], depositAmount1);
  //        await makeDeposit(players[3], depositAmount2);
  //        await makeDeposit(players[3], depositAmount3);
  //      });

  //      it("correctly sums deposits made by the same player within a single round", async () => {
  //        // Проверяем итоговый депозит игрока 0 в roundInfo
  //        const roundInfoData = await program.account.roundInfo.fetch(roundInfo);

  //        // Итоговый депозит игрока 0 должен равняться сумме всех трех депозитов
  //        const totalPlayer0Deposit = 100 * LAMPORTS_PER_SOL + 50 * LAMPORTS_PER_SOL + 25 * LAMPORTS_PER_SOL;
  //        const player0Deposit = roundInfoData.deposits.find(
  //          (deposit: any) => deposit.depositor.toString() === players[3].publicKey.toString()
  //        );

  //        assert.isDefined(player0Deposit, "Player 0's deposit should be defined in roundInfo");
  //        assert.equal(
  //          player0Deposit.tokenAmount.toString(),
  //          totalPlayer0Deposit.toString(),
  //          "Player 0's deposits should be correctly summed"
  //        );
  //      });
  //    });
  //    describe("Change Owner", () => {
  //      it("allows the current owner to change ownership and prevents the old owner from making further changes", async () => {
  //        const newOwner = Keypair.generate();
  //        const oldOwner = owner;

  //        // Сменяем владельца на нового
  //        await program.methods
  //          .changeOwner(newOwner.publicKey)
  //          .accounts({
  //            config: config,
  //            currentOwner: oldOwner.publicKey,
  //          })
  //          .signers([oldOwner])
  //          .rpc();

  //        // Проверяем, что новый владелец записан в конфигурации
  //        let configData = await program.account.config.fetch(config);
  //        assert.equal(configData.owner.toString(), newOwner.publicKey.toString(), "Owner should be updated to the new owner");

  //        // Попытка старого владельца снова сменить владельца (должна завершиться ошибкой)
  //        try {
  //          await program.methods
  //            .changeOwner(Keypair.generate().publicKey)
  //            .accounts({
  //              config: config,
  //              currentOwner: oldOwner.publicKey,
  //            })
  //            .signers([oldOwner])
  //            .rpc();

  //          assert.fail("Old owner should not be able to change ownership after it has been transferred");
  //        } catch (err) {
  //          assert.equal(err.error.errorCode.code, "Unauthorized", "Error should be Unauthorized when old owner tries to change ownership again");
  //        }

  //        // Новый владелец меняет владельца обратно на старого
  //        await program.methods
  //          .changeOwner(oldOwner.publicKey)
  //          .accounts({
  //            config: config,
  //            currentOwner: newOwner.publicKey,
  //          })
  //          .signers([newOwner])
  //          .rpc();

  //        // Проверяем, что владелец вернулся к старому владельцу
  //        configData = await program.account.config.fetch(config);
  //        assert.equal(configData.owner.toString(), oldOwner.publicKey.toString(), "Ownership should be reverted to the original owner");
  //      });
  //    });


  //    describe("Admin Withdraw", () => {
  //      before(async () => {
  //        // Убедимся, что выполнены депозиты и определен победитель перед вызовом admin_withdraw
  //        const depositAmount1 = 100 * LAMPORTS_PER_SOL;
  //        const depositAmount2 = 202 * LAMPORTS_PER_SOL;

  //        await makeDeposit(players[0], depositAmount1);
  //        await makeDeposit(players[1], depositAmount2);

  //        // Игрок 0 выиграл первый раунд
  //        await drawWinner(players[0]);
  //      });

  //      it("allows the admin to withdraw all funds from the winners_vault", async () => {
  //        // Проверяем начальный баланс winners_vault
  //        const initialVaultBalance = await Token.getAccount(provider.connection, winnersVault);
  //        console.log("Initial winners_vault balance:", initialVaultBalance.amount.toString());
  //        const initialOwnerBalance = await Token.getAccount(provider.connection, ownerTokenAccount);
  //        // Администратор (владелец) выводит все средства из winners_vault
  //        await program.methods
  //          .adminWithdraw(_winnersVaultBump, new anchor.BN(initialVaultBalance.amount.toString()))
  //          .accounts({
  //            config: config,
  //            winnersVault: winnersVault,
  //            adminAccount: ownerTokenAccount, // Выведем средства на аккаунт игрока 0
  //            owner: owner.publicKey,
  //            tokenProgram: TOKEN_PROGRAM_ID,
  //          })
  //          .signers([owner])
  //          .rpc();

  //        // Проверяем, что баланс winners_vault обнулен
  //        const finalVaultBalance = await Token.getAccount(provider.connection, winnersVault);
  //        assert.equal(finalVaultBalance.amount.toString(), "0", "Winners vault balance should be 0 after admin withdrawal");

  //        // Проверяем, что баланс аккаунта, на который были выведены средства, увеличился на сумму вывода
  //        const finalOwnerBalance = await Token.getAccount(provider.connection, ownerTokenAccount);
  //        assert.equal(
  //          finalOwnerBalance.amount.toString(),
  //          (initialVaultBalance.amount + initialOwnerBalance.amount).toString(),
  //          "Player's token account balance should increase by the withdrawn amount"
  //        );
  //      });
  //    });

  //    describe("Single ones", () => {
  //      it("should fail on deposit overflow", async () => {
  //        const largeDepositAmount = new anchor.BN('18446744073709551616'); // u64::MAX + 1
  //        try {
  //            await program.methods
  //                .deposit(_vaultBump, largeDepositAmount)
  //                .accounts({
  //                    vaultAccount: vaultAccount,
  //                    roundInfo: roundInfo,
  //                    user: players[0].publicKey,
  //                    userTokenAccount: playerTokenAccounts[0],
  //                    mint: mint,
  //                    tokenProgram: TOKEN_PROGRAM_ID,
  //                    systemProgram: SystemProgram.programId,
  //                })
  //                .signers([players[0]])
  //                .rpc();
        
  //            assert.fail("Deposit should have failed due to overflow");
  //        } catch (err) {
  //            // assert.include(err.toString(), "Error: Overflow", "Expected overflow error");
  //            // assert.equal(err.error.errorCode.code, "Overflow", "Expected overflow error");
  //            console.log(err.toString())
  //        }
  //    });
     // it("should handle high load of deposits without DoS", async () => {
     //   for (let i = 0; i < 100; i++) { // Попробуем сделать 1000 депозитов
     //       const smallDeposit = new anchor.BN(1);
     //       await program.methods
     //           .deposit(_vaultBump, smallDeposit)
     //           .accounts({
     //               vaultAccount: vaultAccount,
     //               roundInfo: roundInfo,
     //               user: players[i % players.length].publicKey, // Поворачиваем игроков
     //               userTokenAccount: playerTokenAccounts[i % players.length],
     //               mint: mint,
     //               tokenProgram: TOKEN_PROGRAM_ID,
     //               systemProgram: SystemProgram.programId,
     //           })
     //           .signers([players[i % players.length]])
     //           .rpc();
     //       // console.log(i)
     //   }
  
     //   // Убедитесь, что программа продолжает работать нормально после большого числа депозитов
     //   const roundInfoData = await program.account.roundInfo.fetch(roundInfo);
     //   assert.isTrue(roundInfoData.totalDeposits.gte(new anchor.BN(100)), "Total deposits should be at least 1000 after high load");
     // });
  //    it("should prevent unauthorized user from drawing a winner", async () => {
  //      try {
  //          await program.methods
  //              .drawWinner(_vaultBump, players[0].publicKey) // Попытка другого пользователя выбрать победителя
  //              .accounts({
  //                  config: config,
  //                  roundInfo: roundInfo,
  //                  vaultAccount: vaultAccount,
  //                  winners: winners,
  //                  winnersVault: winnersVault,
  //                  owner: players[1].publicKey, // Используем игрока, а не владельца
  //                  mint: mint,
  //                  tokenProgram: TOKEN_PROGRAM_ID,
  //                  systemProgram: SystemProgram.programId,
  //              })
  //              .signers([players[1]]) // Не владелец
  //              .rpc();
        
  //          assert.fail("Non-owner should not be able to draw a winner");
  //      } catch (err) {
  //          assert.equal(err.error.errorCode.code, "Unauthorized", "Only owner should be able to draw a winner");
  //          // console.log(err.error.errorCode.code)
  //      }
  //  });
  //  it("should reject deposits with different mints in the same round", async () => {
  //    const anotherMint = await Token.createMint(
  //        provider.connection,
  //        owner,
  //        owner.publicKey,
  //        null,
  //        9,
  //    );
  //    const playerTokenAccountWithAnotherMint = await Token.getOrCreateAssociatedTokenAccount(
  //        provider.connection,
  //        owner,
  //        anotherMint,
  //        players[0].publicKey
  //    )
  //    await Token.mintTo(provider.connection, owner, anotherMint, playerTokenAccountWithAnotherMint.address, owner.publicKey, 10000 * LAMPORTS_PER_SOL)
  //    try {
  //        await program.methods
  //            .deposit(_vaultBump, new anchor.BN(1000))
  //            .accounts({
  //                vaultAccount: vaultAccount,
  //                roundInfo: roundInfo,
  //                user: players[0].publicKey,
  //                userTokenAccount: playerTokenAccountWithAnotherMint.address, // Используем другой mint
  //                mint: anotherMint,
  //                tokenProgram: TOKEN_PROGRAM_ID,
  //                systemProgram: SystemProgram.programId,
  //            })
  //            .signers([players[0]])
  //            .rpc();
      
  //        assert.fail("Deposit with different mint should be rejected");
  //    } catch (err) {
  //        assert.include(err.toString(), "Error", "Expected error when depositing with different mint");
  //    }
  //    })
  //    })
  // describe("sol_betting_game_reward_distribution", () => {
  //   let initialDeposits: number[] = [100000, 200000, 300000]; // Пример сумм депозитов
  //   let winnerIndex: number;
  
  //   beforeEach(async () => {
  //     // Создание аккаунтов игроков
  //     for (let i = 0; i < initialDeposits.length; i++) {
  //       const player = players[i];
        
  //         await makeDeposit(player, initialDeposits[i]);
  //     }
  //   });
  
  //   it("should correctly distribute rewards after the first round", async () => {
  //     // Определяем победителя и завершаем раунд
  //     winnerIndex = 1; // Например, игрок с индексом 1 - победитель
  //     await drawWinner(players[winnerIndex]);
  
  //     const winnerTokenAccount_before = await Token.getAccount(provider.connection, playerTokenAccounts[winnerIndex]);
  //     const ownerTokenAccount_before = await Token.getAccount(provider.connection, ownerTokenAccount);
  //     const winnerTreasury_before = await Token.getAccount(provider.connection, winnersVault);
  //     // Победитель забирает награду
  //     await claimReward(players[winnerIndex]);
      
  //     // Проверка баланса победителя
  //     const winnerTokenAccount_after = await Token.getAccount(provider.connection, playerTokenAccounts[winnerIndex]);
  //     const ownerTokenAccount_after = await Token.getAccount(provider.connection, ownerTokenAccount);
  //     const winnerTreasury_after = await Token.getAccount(provider.connection, winnersVault);
  //   //   assert.strictEqual(winnerTokenAccount.amount.toString(), expectedReward.toString(), "Reward distribution failed after first round");
  //   console.log("winnerTokenAccount_before ", winnerTokenAccount_before.amount.toString())
  //   console.log("winnerTokenAccount_after ",winnerTokenAccount_after.amount.toString())
  //   console.log("ownerTokenAccount_before ", ownerTokenAccount_before.amount.toString())
  //   console.log("ownerTokenAccount_after ", ownerTokenAccount_after.amount.toString())
  //   console.log("winnerTreasury_before ", winnerTreasury_before.amount.toString())
  //   console.log("winnerTreasury_after ", winnerTreasury_after.amount.toString())
  //   });
  
  //   it("should allow winner to claim rewards after a delayed round", async () => {
  //     // Определяем нового победителя, но он заберет награду позже
  //     winnerIndex = 0; // Например, игрок с индексом 0 - победитель
  //     await drawWinner(players[winnerIndex]);
  
  //     // Открываем новый раунд и игроки снова делают депозиты
  //     for (let i = 0; i < players.length; i++) {
  //       await makeDeposit(players[i], initialDeposits[i]);
  //     }
  
  //     const winnerTokenAccount_before = await Token.getAccount(provider.connection, playerTokenAccounts[winnerIndex]);
  //     const ownerTokenAccount_before = await Token.getAccount(provider.connection, ownerTokenAccount);
  //     const winnerTreasury_before = await Token.getAccount(provider.connection, winnersVault);
  //     // Победитель забирает награду
  //     await claimReward(players[winnerIndex]);
      
  //     // Проверка баланса победителя
  //     const winnerTokenAccount_after = await Token.getAccount(provider.connection, playerTokenAccounts[winnerIndex]);
  //     const ownerTokenAccount_after = await Token.getAccount(provider.connection, ownerTokenAccount);
  //     const winnerTreasury_after = await Token.getAccount(provider.connection, winnersVault);
  //   //   assert.strictEqual(winnerTokenAccount.amount.toString(), expectedReward.toString(), "Reward distribution failed after first round");
  //   console.log("winnerTokenAccount_before ", winnerTokenAccount_before.amount.toString())
  //   console.log("winnerTokenAccount_after ",winnerTokenAccount_after.amount.toString())
  //   console.log("ownerTokenAccount_before ", ownerTokenAccount_before.amount.toString())
  //   console.log("ownerTokenAccount_after ", ownerTokenAccount_after.amount.toString())
  //   console.log("winnerTreasury_before ", winnerTreasury_before.amount.toString())
  //   console.log("winnerTreasury_after ", winnerTreasury_after.amount.toString())
  //   });
  
  //   it("should correctly distribute rewards after a second round", async () => {
  //     // Определяем нового победителя
  //     winnerIndex = 2; // Например, игрок с индексом 2 - победитель
  //     await drawWinner(players[winnerIndex]);
  
  //     // Победитель забирает награду
  //     await claimReward(players[winnerIndex]);
  
  //     // Проверка баланса победителя второго раунда
  //     const winnerTokenAccount = await Token.getAccount(provider.connection, playerTokenAccounts[winnerIndex]);
  //     const expectedReward = initialDeposits.reduce((acc, val) => acc + val, 0);
  //     assert.strictEqual(winnerTokenAccount.amount.toString(), expectedReward.toString(), "Reward distribution failed after second round");
  //   });
  // describe("sol_betting_game", () => {
  //   it("should distribute rewards correctly", async () => {

  //     await printBalance(players[0].publicKey, "Player 0", "before 1 round");
  //     await printBalance(players[1].publicKey, "Player 1", "before 1 round");
  //     await printBalance(players[2].publicKey, "Player 2", "before 1 round");
  //     await printPDABalance(winnersVault, "winnersVault", "before 1 round");

  //     await makeDeposit(players[0], 111 * LAMPORTS_PER_SOL);
  //     await makeDeposit(players[1], 222 * LAMPORTS_PER_SOL);
  //     await makeDeposit(players[2], 333 * LAMPORTS_PER_SOL);
  //     await drawWinner(players[0]);

  //     await printPDABalance(winnersVault, "winnersVault", "after 1 round");
      
  //     await makeDeposit(players[1], 400 * LAMPORTS_PER_SOL);
  //     await makeDeposit(players[2], 500 * LAMPORTS_PER_SOL);
  //     await drawWinner(players[1]); 

  //     await printPDABalance(winnersVault, "winnersVault", "after 2 round");
      
  //     await claimReward(players[0]);
  //     await printPDABalance(winnersVault, "winnersVault", "after 2 round and 1 claim");
  //     await printBalance(players[0].publicKey, "Player 0", "after 2 round and 1 claim");
      
  //     await claimReward(players[1]);
  //     await printPDABalance(winnersVault, "winnersVault", "after 2 round and 2 claim");
  //     await printBalance(players[1].publicKey, "Player 1", "after 2 round and 2 claim");
  //   })
  // })

  describe("sol_betting_game", () => {
    it("should distribute rewards correctly", async () => {

      await printBalance(players[0].publicKey, "Player 0", "before 1 round");
      await printBalance(players[1].publicKey, "Player 1", "before 1 round");
      await printBalance(players[2].publicKey, "Player 2", "before 1 round");
      await printPDABalance(winnersVault, "winnersVault", "before 1 round");

      await makeDeposit(players[0], 111 * LAMPORTS_PER_SOL);
      await makeDeposit(players[1], 222 * LAMPORTS_PER_SOL);
      await makeDeposit(players[2], 333 * LAMPORTS_PER_SOL);
      console.log("winner is 0 player")
      await drawWinner(players[0]);
      console.log((await program.account.winners.fetch(winners)).records[0].winner.toString());
      console.log((await program.account.winners.fetch(winners)).records[0].amount.toString());
      await printPDABalance(winnersVault, "winnersVault", "after 2 round");

      // await makeDeposit(players[0], 444 * LAMPORTS_PER_SOL);
      // await makeDeposit(players[1], 99 * LAMPORTS_PER_SOL);
      // await makeDeposit(players[2], 666 * LAMPORTS_PER_SOL);
      // console.log("winner is 1 player")

      // await drawWinner(players[1]);
      // await printPDABalance(winnersVault, "winnersVault", "after 3 round");
      
      // await makeDeposit(players[0], 101 * LAMPORTS_PER_SOL);
      // await makeDeposit(players[1], 345 * LAMPORTS_PER_SOL);
      // await makeDeposit(players[2], 567 * LAMPORTS_PER_SOL);
      // console.log("winner is 2 player")

      // await drawWinner(players[2]);
      // await printPDABalance(winnersVault, "winnersVault", "after 3 round");
      
      await makeDeposit(players[0], 200 * LAMPORTS_PER_SOL);
      await makeDeposit(players[1], 300 * LAMPORTS_PER_SOL);
      await makeDeposit(players[2], 400 * LAMPORTS_PER_SOL);
      console.log("winner is 0 player")
      await drawWinner(players[0]);
      console.log((await program.account.winners.fetch(winners)).records[0].winner.toString());
      console.log((await program.account.winners.fetch(winners)).records[0].amount.toString());
      await printPDABalance(winnersVault, "winnersVault", "after 4 round");
      
      await printBalance(players[0].publicKey, "Player 0", "after 4 rounds");
      await printBalance(players[1].publicKey, "Player 1", "after 4 rounds");
      await printBalance(players[2].publicKey, "Player 2", "after 4 rounds");
      
      await claimReward(players[0]);
      await printPDABalance(winnersVault, "winnersVault", "after 4 round and 1 claim");
      await printBalance(players[0].publicKey, "Player 0", "after 4 round and 1 claim");
      
      // await claimReward(players[1]);
      // await printPDABalance(winnersVault, "winnersVault", "after 4 round and 2 claim");
      // await printBalance(players[1].publicKey, "Player 1", "after 4 round and 2 claim");
      
      // await claimReward(players[2]);
      // await printPDABalance(winnersVault, "winnersVault", "after 4 round and 3 claim");
      // await printBalance(players[2].publicKey, "Player 2", "after 4 round and 3 claim");
      // await printPDABalance(winnersVault, "winnersVault", "after 4 round and 4 claim");

    })
  })

  

   
});
