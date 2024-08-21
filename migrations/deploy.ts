import * as anchor from "@project-serum/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, MintLayout, createInitializeMintInstruction, createAssociatedTokenAccountInstruction, mintTo, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import fs from "fs";
import path from "path";


async function main() {
    // Установка соединения с локальным узлом Solana
    const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    console.log("Соединение с локальным узлом установлено");
    const _deploymentData = JSON.parse(fs.readFileSync(path.resolve(__dirname, "deployment_output.json"), "utf8"));
    // Генерация или загрузка ключей для деплоя
    const wallet = anchor.Wallet.local();
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    anchor.setProvider(provider);
    console.log("Провайдер установлен с кошельком:", wallet.publicKey.toBase58());

    // Чтение скомпилированного файла программы
    const programIdl = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../target/idl/sol_betting_game.json"), "utf8"));
    const programKeypair = Keypair.fromSecretKey(
        Buffer.from(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../target/deploy/sol_betting_game-keypair.json"), "utf8")))
    );

    const programId = programKeypair.publicKey;
    const program = new anchor.Program(programIdl, programId, provider);

    console.log("Идентификатор программы:", programId.toBase58());

    console.log("Program ID:", programId.toBase58());

    // Генерация аккаунтов
    const [vaultAccount, vaultBump] = await PublicKey.findProgramAddress(
        [Buffer.from("vault_account_v")],
        programId
    );
    console.log("Vault Account создан:", vaultAccount.toBase58(), "Bump:", vaultBump);

    const [winnersVault, winnersVaultBump] = await PublicKey.findProgramAddress(
        [Buffer.from("winners_vault_v")],
        programId
    );
    console.log("Winners Vault создан:", winnersVault.toBase58(), "Bump:", winnersVaultBump);

    console.log("Создание аккаунта конфигурации");
    const configAccount = Keypair.generate();
    console.log("Config Account:", configAccount.publicKey.toBase58());

    const roundInfoAccount = Keypair.generate();
    console.log("Round Info Account:", roundInfoAccount.publicKey.toBase58());

    const winnersAccount = Keypair.generate();
    console.log("Winners Account:", winnersAccount.publicKey.toBase58());

    console.log("Создание нового токена");
    const mint = _deploymentData.mint;
    // Keypair.generate();
    console.log("Mint Keypair создан:", mint.publicKey);

    // const mintRent = await connection.getMinimumBalanceForRentExemption(MintLayout.span);
    // console.log("Mint Rent Exemption:", mintRent);

    // const createMintTransaction = new anchor.web3.Transaction().add(
    //     SystemProgram.createAccount({
    //         fromPubkey: wallet.publicKey,
    //         newAccountPubkey: mint.publicKey,
    //         lamports: mintRent,
    //         space: MintLayout.span,
    //         programId: TOKEN_PROGRAM_ID,
    //     }),
    //     createInitializeMintInstruction(
    //         mint.publicKey, // Mint Pubkey
    //         9, // Decimals
    //         wallet.publicKey, // Mint Authority
    //         wallet.publicKey // Freeze Authority
    //     )
    // );

    // console.log("Отправка транзакции на создание нового токена");
    // await provider.sendAndConfirm(createMintTransaction, [mint]);

    console.log("Mint найден:", mint.publicKey);

    // Создание 4-х кошельков для игроков
    console.log("Генерация 4-х кошельков для игроков");
    // const players = Array.from({ length: 4 }, () => Keypair.generate());
    // players.forEach((player, index) => {
    // });
    
    const players: {keypair: Keypair, tokenAccount: PublicKey}[] = _deploymentData.players.map((playerData: any) => {
        const keypair = Keypair.fromSecretKey(Uint8Array.from(playerData.secretKey));
        console.log(`Player  Public Key: ${playerData.publicKey}`);
        return {
            keypair,
            tokenAccount: new PublicKey(playerData.tokenAccount)
        };
    });

    // Создание токен-аккаунтов для овнера и игроков
    console.log("Создание токен-аккаунтов для овнера и игроков");

    const ownerTokenAccount = await getOrCreateAssociatedTokenAccount(provider.connection, wallet.payer, new PublicKey(mint.publicKey), wallet.publicKey);
    console.log("Owner Token Account создан:", ownerTokenAccount.address.toBase58());

    const playerTokenAccounts = [];
    for (let i = 0; i < players.length; i++) {
        const playerTokenAccount = await getOrCreateAssociatedTokenAccount(provider.connection, players[i].keypair, new PublicKey(mint.publicKey), players[i].keypair.publicKey);
        console.log(`Player ${i + 1} Token Account создан:`, playerTokenAccount.address.toBase58());
        playerTokenAccounts.push(playerTokenAccount);
    }

    // Mint токенов овнеру и игрокам
    // const mintAmount = 1000 * 10 ** 9; // 1000 токенов с учетом decimals
    console.log("Не Минтинг токенов овнеру и игрокам");
    // await mintTo(connection, wallet.payer, new PublicKey(mint.publicKey), ownerTokenAccount.address, wallet.publicKey, mintAmount);
    // console.log("Овнеру заминчено:", mintAmount);

    // for (let i = 0; i < players.length; i++) {
    //     await mintTo(connection, wallet.payer, new PublicKey(mint.publicKey), playerTokenAccounts[i].address, wallet.publicKey, mintAmount);
    //     console.log(`Player ${i + 1} заминчено:`, mintAmount);
    // }

    console.log("Вызов инициализации программы");
    await program.methods.initialize(wallet.publicKey)
        .accounts({
            config: configAccount.publicKey,
            roundInfo: roundInfoAccount.publicKey,
            winners: winnersAccount.publicKey,
            owner: wallet.publicKey,
            winnersVault: winnersVault,
            vaultAccount: vaultAccount,
            mint: new PublicKey(mint.publicKey),
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([configAccount, roundInfoAccount, winnersAccount, wallet.payer])
        .rpc({
        });

    console.log("Программа инициализирована с аккаунтом конфигурации:", configAccount.publicKey.toBase58());

    // Сохранение всех данных в файл
    const deploymentData = {
        programId: programId.toBase58(),
        configAccount: {
            publicKey: configAccount.publicKey.toBase58(),
            secretKey: Array.from(configAccount.secretKey),
        },
        roundInfoAccount: {
            publicKey: roundInfoAccount.publicKey.toBase58(),
            secretKey: Array.from(roundInfoAccount.secretKey),
        },
        winnersAccount: {
            publicKey: winnersAccount.publicKey.toBase58(),
            secretKey: Array.from(winnersAccount.secretKey),
        },
        vaultAccount: {
            publicKey: vaultAccount.toBase58(),
            bump: vaultBump,
        },
        winnersVault: {
            publicKey: winnersVault.toBase58(),
            bump: winnersVaultBump,
        },
        mint: {
            publicKey: new PublicKey(mint.publicKey),
            // secretKey: Array.from(mint.secretKey),
        },
        owner: {
            publicKey: wallet.publicKey.toBase58(),
            tokenAccount: ownerTokenAccount.address.toBase58(),
        },
        players: players.map((player, index) => ({
            publicKey: player.keypair.publicKey.toBase58(),
            secretKey: Array.from(player.keypair.secretKey),
            tokenAccount: playerTokenAccounts[index].address,
        })),
    };

    const outputFilePath = path.resolve(__dirname, "deployment_output.json");
    fs.writeFileSync(outputFilePath, JSON.stringify(deploymentData, null, 2));
    console.log("Все данные о деплое сохранены в файл:", outputFilePath);
}

main().then(() => {
    console.log("Скрипт деплоя завершен.");
}).catch((err) => {
    console.error("Скрипт деплоя завершился с ошибкой:", err);
});
