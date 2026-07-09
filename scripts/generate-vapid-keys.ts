/**
 * Genera un par de claves VAPID para Web Push y las imprime listas para pegar
 * en el .env. No escribe nada por sí mismo.
 *
 * Uso:
 *   npm run generate:vapid
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

console.log("# Pega esto en tu .env (VAPID_SUBJECT ajústalo a tu email/dominio):\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:admin@tudominio.com`);
