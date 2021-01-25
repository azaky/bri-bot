const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const Discord = require('discord.js');
const AsciiTable = require('ascii-table');

require('dotenv').config();
if (!process.env.COOKIE) {
  console.error('COOKIE envvar is required!');
  process.exit(1);
}


let discord, user;

if (process.env.DISCORD_TOKEN && process.env.DISCORD_USER_ID) {
  discord = new Discord.Client();
  discord.login(process.env.DISCORD_TOKEN);

  discord.on('ready', () => {
    console.log(`Logged in as ${discord.user.tag}!`);

    notify(`Hey there, I'm alive!`);
  });

  discord.on('message', message => {
    console.log('got message from', message.author.id, message.content);
  });
}

const notify = async content => {
  if (!discord) return;

  if (!user) {
    console.log('fetching user...');
    user = await discord.users.fetch(process.env.DISCORD_USER_ID);
    console.log(user);
  }

  await user.send(content);
};

const notifyError = async error => {
  const embed = new Discord.MessageEmbed()
    .setColor('red')
    .setTitle('An Error Occurred')
    .setDescription('```bash\n' + `${error}` + '\n```');
  notify(embed);
};

let scoreboards = [];
let last = null;
let lasttop10 = null;
const contests = ['People Analytics', 'Cash Ratio Optimization'];
const teamname = 'K2IV';

const updateScore = async () => {
  try {
    console.log('started fetching...');

    const response = await fetch("https://brihackathon.id/dashboard", {
      "headers": {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        "accept-language": "en-US,en;q=0.9,id;q=0.8",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "cookie": "PHPSESSID=" + process.env.COOKIE,
      },
      "referrer": "https://brihackathon.id/",
      "referrerPolicy": "origin",
      "body": null,
      "method": "GET",
      "mode": "cors",
    });

    if (response.status !== 200) {
      console.error('status:', response.status);
      await notifyError(`Error fetching the web: status code ${response.status}`);
      return;
    }

    const content = await response.text();

    console.log('finished fetching');

    const dom = new JSDOM(content);
    const document = dom.window.document;

    const tables = [...document.getElementsByTagName('table')].filter(
      (table) => {
        const header = table.parentElement.previousElementSibling.textContent;
        return contests.find(s => s === header);
      }
    );

    if (tables.length !== contests.length) {
      console.error(`there should be ${contests.length} scoreboards, but only found`, tables.length);
      await notifyError(`Error fetching the web: there should be ${contests.length} scoreboards, but found ${tables.length}`);
      return;
    }

    scoreboards = tables.map(
      table => [...table.children[1].children].map(
        tr => ({
          rank: tr.children[0].textContent,
          name: tr.children[1].textContent,
          score: tr.children[2].textContent,
          timestamp: tr.children[3].textContent,
        })
      )
    );

    const ours = scoreboards.map(scoreboard => scoreboard.find(team => team.name === teamname));
    console.log(ours);

    // perhaps there should be a better way to do this
    const serialized = JSON.stringify(ours);
    if (JSON.stringify(last) !== serialized) {
        const updates = ours.map((result, i) => {
        const changes = [];
        if (last) {
          if (result.rank < last[i].rank) {
            changes.push(`Team ${teamname} moved up the leaderboard from **rank ${last[i].rank}** to **rank ${result.rank}**!`);
          }
          if (result.rank > last[i].rank) {
            changes.push(`Team ${teamname} moved down the leaderboard from **rank ${last[i].rank}** to **rank ${result.rank}** 😔`);
          }
          if (result.score > last[i].score) {
            changes.push(`Team ${teamname}'s score improved from **${last[i].score}** to **${result.score}**!`);
          }
          if (result.score < last[i].score) {
            changes.push(`Team ${teamname}'s score decreased from **${last[i].score}** to **${result.score}** ... but ... how ...?`);
          }
        } else {
          changes.push(`Team ${teamname} is on **rank ${result.rank}** of ${scoreboards[i].length} with score **${result.score}**`);
        }
        if (changes.length > 0) {
          changes.push(`> Submission Date: ${result.timestamp}`);
        }
        return {
          name: contests[i],
          value: changes.join('\n'),
        };
      });
      const message = new Discord.MessageEmbed()
        .setColor('#008891')
        .setTitle('Rank Notification')
        .setThumbnail('https://brihackathon.id/images/logo-bri-hackathon.png')
        .setDescription('');
      updates.forEach(update => {
        if (update.value) {
          message.addField(update.name, update.value);
        }
      });
      await notify(message);
      last = ours;
    }

    const top10 = scoreboards.map(scoreboard => scoreboard.slice(0, 10));
    const top10serialized = JSON.stringify(top10);
    if (top10serialized !== JSON.stringify(lasttop10)) {
      const message = new Discord.MessageEmbed()
        .setColor('#008891')
        .setTitle('Top 10 Leaderboard')
        .setThumbnail('https://brihackathon.id/images/logo-bri-hackathon.png')
        .setDescription('');
      contests.forEach((title, i) => {
        const table = new AsciiTable()
        table.setHeading('Rank', 'Team Name', 'Score');
        top10[i].forEach((team, rank) => table.addRow(rank+1, team.name, team.score));
        message.addField(title, ['```', table.toString(), '```'].join('\n'));
      });
      await notify(message);
      lasttop10 = top10;
    }
  } catch (e) {
    console.error('Uncaught exception:', e);
    notifyError(e);
  }
};

updateScore();
setInterval(() => {
  updateScore();
}, 60000);
