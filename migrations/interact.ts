import * as anchor from "@project-serum/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import fs from "fs";
import path from "path";

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function main() {
    console.log("Загрузка данных из deployment_output.json");
    const deploymentData = JSON.parse(fs.readFileSync(path.resolve(__dirname, "deployment_output.json"), "utf8"));

    console.log("Установка соединения и провайдера");
    const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
    const wallet = anchor.Wallet.local();
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    anchor.setProvider(provider);

    console.log("Загрузка программы");
    const programId = new PublicKey(deploymentData.programId);
    const programIdl = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../target/idl/sol_betting_game.json"), "utf8"));
    const program = new anchor.Program(programIdl, programId, provider);

    console.log("Восстановление аккаунтов из данных JSON");
    const configAccount = new PublicKey(deploymentData.configAccount.publicKey);
    const roundInfoAccount = new PublicKey(deploymentData.roundInfoAccount.publicKey);
    const winnersAccount = new PublicKey(deploymentData.winnersAccount.publicKey);
    const vaultAccount = new PublicKey(deploymentData.vaultAccount.publicKey);
    const vaultBump = deploymentData.vaultAccount.bump;
    const winnersVault = new PublicKey(deploymentData.winnersVault.publicKey);
    const winnersVaultBump = deploymentData.winnersVault.bump;
    const mint = new PublicKey(deploymentData.mint.publicKey);
    const owner = wallet.payer;
    const ownerTokenAccount = new PublicKey(deploymentData.owner.tokenAccount);
    const players = deploymentData.players.map((playerData: any) => {
        const keypair = Keypair.fromSecretKey(Uint8Array.from(playerData.secretKey));
        return {
            keypair,
            tokenAccount: new PublicKey(playerData.tokenAccount)
        };
    });

    console.log("Вызов функции deposit для каждого игрока");
    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        console.log(`Игрок ${i + 1} делает депозит`);

        const initialPlayerBalance = (await getAccount(provider.connection, player.tokenAccount)).amount.toString();

        await delay(1000);
        console.log("TX: ", await program.methods.deposit(vaultBump, new anchor.BN(10**10 * 2))
            .accounts({
                vaultAccount: vaultAccount,
                roundInfo: roundInfoAccount,
                user: player.keypair.publicKey,
                userTokenAccount: player.tokenAccount,
                mint: mint,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([player.keypair])
            .rpc())

        const finalPlayerBalance = (await getAccount(provider.connection, player.tokenAccount)).amount.toString();
        console.log(`Баланс игрока ${i + 1} до депозита: ${initialPlayerBalance}, после депозита: ${finalPlayerBalance}`);
        if (parseInt(finalPlayerBalance) >= parseInt(initialPlayerBalance)) {
            console.error(`Ошибка: депозит игрока ${i + 1} не был выполнен корректно.`);
        } else {
            console.log(`Депозит от игрока ${i + 1} выполнен успешно.`);
        }
    }

    console.log("Вызов функции drawWinner для определения победителя");
    const winnerIndex = 0; // Просто выберите первого игрока в качестве победителя
    console.log("TX: ", await program.methods.drawWinner(vaultBump, players[winnerIndex].keypair.publicKey)
        .accounts({
            config: configAccount,
            roundInfo: roundInfoAccount,
            vaultAccount: vaultAccount,
            winners: winnersAccount,
            winnersVault: winnersVault,
            owner: owner.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc());

    console.log("Проверка баланса winnersVault после drawWinner");
    const winnersVaultBalance = ((await getAccount(provider.connection, winnersVault))).toString();
    console.log(`Баланс winnersVault после drawWinner: ${winnersVaultBalance}`);

    console.log("Вызов функции claimReward для победителя");
    console.log("TX: ", await program.methods.claimReward(winnersVaultBump)
        .accounts({
            winners: winnersAccount,
            winnersVault: winnersVault,
            user: players[winnerIndex].keypair.publicKey,
            userTokenAccount: players[winnerIndex].tokenAccount,
            ownerTokenAccount: ownerTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([players[winnerIndex].keypair])
        .rpc());

    const winnerFinalBalance = (await getAccount(provider.connection, players[winnerIndex].tokenAccount)).amount.toString();
    console.log(`Баланс победителя после claimReward: ${winnerFinalBalance}`);

    console.log("Вызов функции deposit для каждого игрока снова");
    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        console.log(`Игрок ${i + 1} делает депозит еще раз`);

        const initialPlayerBalance = (await getAccount(provider.connection, player.tokenAccount)).amount.toString();

        await delay(1000);
        console.log("TX: ", await program.methods.deposit(vaultBump, new anchor.BN(10**10 * 2))
            .accounts({
                vaultAccount: vaultAccount,
                roundInfo: roundInfoAccount,
                user: player.keypair.publicKey,
                userTokenAccount: player.tokenAccount,
                mint: mint,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([player.keypair])
            .rpc());

        const finalPlayerBalance = (await getAccount(provider.connection, player.tokenAccount)).amount.toString();
        console.log(`Баланс игрока ${i + 1} до депозита: ${initialPlayerBalance}, после депозита: ${finalPlayerBalance}`);
        if (parseInt(finalPlayerBalance) >= parseInt(initialPlayerBalance)) {
            console.error(`Ошибка: депозит игрока ${i + 1} не был выполнен корректно.`);
        } else {
            console.log(`Депозит от игрока ${i + 1} выполнен успешно.`);
        }
    }
    console.log("Выбор победителя ОПЯТЬ")
    console.log("TX: ", await program.methods.drawWinner(vaultBump, players[winnerIndex].keypair.publicKey)
        .accounts({
            config: configAccount,
            roundInfo: roundInfoAccount,
            vaultAccount: vaultAccount,
            winners: winnersAccount,
            winnersVault: winnersVault,
            owner: owner.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc());
    console.log("Вызов функции admin_withdraw для вывода средств администратором");
    const initialVaultBalance = (await getAccount(provider.connection, winnersVault)).amount.toString();
    console.log("Initial winners_vault balance:", initialVaultBalance);
    console.log(await program.methods.adminWithdraw(winnersVaultBump, new anchor.BN(initialVaultBalance))
        .accounts({
            config: configAccount,
            winnersVault: winnersVault,
            adminAccount: ownerTokenAccount,
            owner: owner.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc());
    const finalVaultBalance = (await getAccount(provider.connection, winnersVault)).amount.toString();
    console.log(`Баланс winnersVault после adminWithdraw: ${finalVaultBalance}`);

    if (parseInt(finalVaultBalance) > 0) {
        console.error("Ошибка: средства не были полностью выведены администратором.");
    } else {
        console.log("Средства успешно выведены администратором.");
    }

    console.log("Вызов функции change_owner для изменения владельца");
    const newOwner = Keypair.generate();
    console.log("TX: ", await program.methods.changeOwner(newOwner.publicKey)
        .accounts({
            config: configAccount,
            currentOwner: owner.publicKey,
        })
        .signers([owner])
        .rpc());
    console.log(`Владелец изменен на ${newOwner.publicKey.toBase58()}`);
    console.log("TX: ", await program.methods.changeOwner(owner.publicKey)
    .accounts({
        config: configAccount,
        currentOwner: newOwner.publicKey,
    })
    .signers([newOwner])
    .rpc());
    console.log(`Владелец изменен на ${owner.publicKey.toBase58()}`);
    console.log("Все функции выполнены успешно");
}

main().then(() => {
    console.log("Скрипт тестирования завершен.");
}).catch((err) => {
    console.error("Скрипт тестирования завершился с ошибкой:", err);
});
