import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import * as fs from 'fs';
import * as readline from 'readline';

// Подключение к Solana mainnet
const connection = new Connection('https://serene-quick-sailboat.solana-mainnet.quiknode.pro/', 'confirmed');

// Функция для проверки баланса токен аккаунта
async function checkTokenBalance(publicKey: string, tokenMint: string): Promise<string> {
    try {
        const publicKeyObj = new PublicKey(publicKey);
        const tokenMintObj = new PublicKey(tokenMint);

        // Получаем токен аккаунт
        const tokenAccount = await getAssociatedTokenAddress(tokenMintObj, publicKeyObj);

        // Получаем информацию о токен аккаунте
        const accountInfo = await getAccount(connection, tokenAccount);

        // Проверяем баланс
        return accountInfo.amount > BigInt(0) ? 'YES' : 'NO';
    } catch (error) {
        console.error(`Ошибка для ${publicKey}: ${error}`);
        return 'NO';
    }
}

// Чтение файла и обработка данных
async function processFile(filePath: string) {
    const fileStream = fs.createReadStream(filePath);

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    for await (const line of rl) {
        const [publicKey, _] = line.split(',');
        const result = await checkTokenBalance(publicKey, "CGPoSJ4mLErDe7Mb2cb11Z6xhjADtGcQXXUi7Nmaruax");
        console.log(`${publicKey},${"CGPoSJ4mLErDe7Mb2cb11Z6xhjADtGcQXXUi7Nmaruax"},${result}`);
        await new Promise(resolve => setTimeout(resolve, 450));
    }
}

// Указываем путь к CSV файлу
const filePath = '/Users/rustam/Documents/solana_projects/vodka/migrations/output.csv';
processFile(filePath).then(() => console.log('Готово!')).catch(console.error);
