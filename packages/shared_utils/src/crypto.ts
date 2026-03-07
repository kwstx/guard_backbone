import * as crypto from 'node:crypto';
import { KeyPair } from './types';

export class CryptoUtils {
    static generateKeyPair(): KeyPair {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem',
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem',
            },
        });
        return { publicKey, privateKey };
    }

    static sign(data: string, privateKey: string): string {
        const sign = crypto.createSign('SHA256');
        sign.update(data);
        sign.end();
        return sign.sign(privateKey, 'base64');
    }

    static verify(data: string, signature: string, publicKey: string): boolean {
        const verify = crypto.createVerify('SHA256');
        verify.update(data);
        verify.end();
        return verify.verify(publicKey, signature, 'base64');
    }
}
