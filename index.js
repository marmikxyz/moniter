const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const URL = 'https://nests.tribal.gov.in/show_content.php?lang=1&level=1&ls_id=949&lid=550';
const BASE = 'https://nests.tribal.gov.in/';

const bot = new Telegraf(BOT_TOKEN);

function loadData() {
  try {
    return JSON.parse(fs.readFileSync('data.json', 'utf8'));
  } catch {
    return { lastPosted: '' };
  }
}

function saveData(data) {
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
}

async function fetchNotifications() {
  const { data } = await axios.get(URL, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const $ = cheerio.load(data);
  const notifications = [];

  // Find the table rows that contain the notifications
  $("table tr").each((_, row) => {
    const cols = $(row).find("td");
    if (cols.length < 5) return;

    const title = $(cols[1]).text().replace(/\\s+/g, " ").trim();
    const date = $(cols[2]).text().replace(/\\s+/g, " ").trim();

    let pdf = $(cols[4]).find("a").attr("href");
    if (!title || !pdf) return;

    if (pdf.startsWith("./")) pdf = pdf.slice(2);
    if (!pdf.startsWith("http")) pdf = BASE + pdf;

    notifications.push({
      title,
      date,
      url: pdf
    });
  });

  return notifications;
}
async function checkForNewNotifications() {
  try {
    const notifications = await fetchNotifications();
    if (!notifications.length) return;

    const latest = notifications[0];
    const db = loadData();

    if (db.lastPosted !== latest.url) {
      await bot.telegram.sendMessage(
        CHANNEL_ID,
        `New NESTS / EMRS Notification\\n\\n` +
        `*${latest.title}*\\n` +
        `Published: ${latest.date}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "Download PDF", url: latest.url }
            ]]
          }
        }
      );

      db.lastPosted = latest.url;
      saveData(db);
      console.log("Posted:", latest.title);
    }
  } catch (e) {
    console.error(e);
  }
}

bot.start((ctx) => ctx.reply('Welcome! Use /show to view all current NESTS notifications.'));

bot.command("show", async (ctx) => {
  const notifications = await fetchNotifications();

  const keyboard = notifications.slice(0, 25).map(n => [
    { text: n.title, url: n.url }
  ]);

  await ctx.reply(
    "Current NESTS / EMRS Notifications",
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
});

bot.action(/GET_(\\d+)/, async (ctx) => {
  try {
    const index = Number(ctx.match[1]);
    const notifications = await fetchNotifications();
    const item = notifications[index];
    if (!item) return ctx.answerCbQuery('Notification not found');

    await ctx.answerCbQuery('Downloading...');

    const response = await axios.get(item.url, { responseType: 'arraybuffer' });
    const contentType = response.headers['content-type'] || '';

    if (contentType.includes('pdf') || item.url.toLowerCase().endsWith('.pdf')) {
      await ctx.replyWithDocument({
        source: Buffer.from(response.data),
        filename: item.title.replace(/[\\\\/:*?"<>|]/g, '') + '.pdf'
      }, { caption: item.title });
    } else {
      await ctx.reply(`Title: ${item.title}\\n\\nLink: ${item.url}`);
    }
  } catch (e) {
    console.error(e);
    ctx.reply('Failed to download notification.');
  }
});

cron.schedule('*/2 * * * *', checkForNewNotifications);

checkForNewNotifications();
bot.launch();

console.log('NESTS bot is running...');
