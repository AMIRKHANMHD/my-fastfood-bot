require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ۱. نرمال‌سازی متن برای فهمیدن اعداد فارسی و انگلیسی
function normalizeText(text) {
    if (!text) return "";
    return text.toString().toLowerCase()
        .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
        .trim();
}

// ۲. پارسر هوشمند برای استخراج غذا و تعداد
async function parseOrder(text) {
    const dbMenu = await prisma.menuItem.findMany();
    const lines = text.split("\n");
    const foundItems = [];

    for (const line of lines) {
        const normLine = normalizeText(line);
        let quantityMatch = normLine.match(/\d+/);
        let quantity = quantityMatch ? parseInt(quantityMatch[0]) : 1;

        const match = dbMenu.find(m => 
            normLine.includes(normalizeText(m.name)) || 
            normalizeText(m.name).includes(normLine)
        );

        if (match) {
            foundItems.push({ id: match.id, name: match.name, price: match.price, quantity });
        }
    }
    return foundItems;
}

// ۳. ثبت سفارش در دیتابیس
async function createOrder(chatId, items) {
    const total = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    return await prisma.order.create({
        data: {
            total,
            user: {
                connectOrCreate: {
                    where: { id: chatId },
                    create: { id: chatId, name: "مشتری تلگرامی" }
                }
            },
            items: {
                create: items.map(i => ({
                    menuItemId: i.id,
                    quantity: i.quantity,
                    price: i.price
                }))
            }
        },
        include: { items: { include: { menuItem: true } } }
    });
}

// ۴. ارسال پیام به تلگرام
async function sendToTelegram(chatId, text) {
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text });
    } catch (err) {
        console.error("خطا در ارسال پیام:", err.message);
    }
}

// ۵. دریافت درخواست از تلگرام (Webhook)
app.post('/webhook', async (req, res) => {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat.id.toString();
    const items = await parseOrder(message.text);

    if (items.length === 0) {
        await sendToTelegram(chatId, "منوی ما رو چک کن! متوجه سفارش نشدم. 🍔");
    } else {
        const order = await createOrder(chatId, items);
        let response = `✅ سفارش ثبت شد امیرخان!\n\n`;
        order.items.forEach(i => response += `🔹 ${i.menuItem.name} (${i.quantity} عدد)\n`);
        response += `\n💰 جمع کل: ${order.total.toLocaleString()} تومان`;
        await sendToTelegram(chatId, response);
    }
    res.sendStatus(200);
});

// مسیر تست سلامت
app.get('/', (req, res) => res.send('Bot is Running! 🚀'));

// ۶. تنظیم پورت برای سرور ابری
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is live on port ${PORT}`);
});
