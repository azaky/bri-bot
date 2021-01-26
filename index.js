const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const Discord = require('discord.js');
const AsciiTable = require('ascii-table');
const fs = require('fs');
const { createObjectCsvWriter } = require('csv-writer');

require('dotenv').config();

if (!process.env.COOKIE) {
  console.error('COOKIE envvar is required!');
  process.exit(1);
}
if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN!');
  process.exit(1);
}
if (!process.env.DISCORD_SYSTEM_CHANNEL_ID) {
  console.error('DISCORD_SYSTEM_CHANNEL_ID envvar is required!');
  process.exit(1);
}

const discord = new Discord.Client();
discord.login(process.env.DISCORD_TOKEN);

discord.on('ready', async () => {
  console.log(`Logged in as ${discord.user.tag}!`);

  const systemChannel = await discord.channels.fetch(process.env.DISCORD_SYSTEM_CHANNEL_ID);
  systemChannel.send(`Hey there, I'm alive!`);

  discord.user.setActivity('leaderboard | help', { type: 'WATCHING' });
});

const notify = async (content, to, reportFailure = true) => {
  if (!discord) return;

  try {
    // TODO: Make some queue to avoid network bottleneck.
    //       But it seems that we need to reach hundreds
    //       of users before we start to worry about it.
    const channel = await discord.channels.fetch(to);
    await channel.send(content);
  } catch (e) {
    console.error(`Error notifying ${to}:`, e);
    if (reportFailure) {
      notifyError(`Error notifying ${to}: ${e}`, false);
    }
  }
};

const notifyError = async (error, reportFailure = true) => {
  const embed = new Discord.MessageEmbed()
    .setColor('red')
    .setTitle('An Error Occurred')
    .setDescription('```bash\n' + `${error}` + '\n```');
  notify(embed, process.env.DISCORD_SYSTEM_CHANNEL_ID, reportFailure);
};

// [{type: 'dm|channel', id: '', subscriptions: ['teams']}]
let users = [];
if (fs.existsSync('users.json')) {
  users = JSON.parse(fs.readFileSync('users.json', 'utf-8'));
}

const saveUsers = () => {
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2), 'utf-8');
};

const getUserById = (id, type) => {
  let user = users.find(u => u.id === id);
  let exists = true;
  if (!user) {
    user = {id, type, subscriptions: ['top10']}; // subscribe to top10 by default
    users.push(user);
    exists = false;
    saveUsers();
  }
  return {user, exists};
};

const contests = ['People Analytics', 'Cash Ratio Optimization'];

let scoreboards = [];
let lastFetched = '';

if (fs.existsSync('scoreboards.json')) {
  ({scoreboards, lastFetched} = JSON.parse(fs.readFileSync('scoreboards.json', 'utf-8')));
}

const saveScoreboards = () => {
  fs.writeFileSync('scoreboards.json', JSON.stringify({scoreboards, lastFetched}, null, 2), 'utf-8');
};

const createTop10Embed = (message, prevScoreboards) => {
  const currentTop10 = scoreboards.map(scoreboard => scoreboard.slice(0, 10));
  const prevTop10 = prevScoreboards && prevScoreboards.length && prevScoreboards.map(scoreboard => scoreboard.slice(0, 10));
  const embed = new Discord.MessageEmbed()
    .setColor('#008891')
    .setTitle('Top 10 Leaderboard')
    .setThumbnail('https://brihackathon.id/images/logo-bri-hackathon.png')
    .setDescription(message || '')
    .setFooter(`Last fetched at ${lastFetched}`);
  contests.forEach((title, i) => {
    // list of changes:
    // - kicked from top 10 (disqualified or for whatever reason there is)
    // - someone new moved to the top 10
    // - someone already in the top 10 improved their score
    let changes = [];
    if (prevTop10 && prevTop10[i]) {
      prevTop10[i].forEach(team => {
        if (currentTop10[i].findIndex(t => t.name === team.name) === -1) {
          changes.push(`Team **${team.name.replace(/\*/g, '\\*')}** was out from the top 10`);
        }
      });
      currentTop10[i].forEach(team => {
        if (prevTop10[i].findIndex(t => t.name === team.name) === -1) {
          changes.push(`Team **${team.name.replace(/\*/g, '\\*')}** moved up to **rank ${team.rank}** with score of **${team.score}**`);
        }
      });
      currentTop10[i].forEach(team => {
        const prev = prevTop10[i].find(t => t.name === team.name);
        if (!prev) return;
        if (prev.score !== team.score) {
          if (prev.rank !== team.rank) {
            changes.push(`Team **${team.name.replace(/\*/g, '\\*')}** improved their score from **${prev.score}** to **${team.score}** and moved to **rank ${team.rank}**`);
          } else {
            changes.push(`Team **${team.name.replace(/\*/g, '\\*')}** improved their score from **${prev.score}** to **${team.score}**`);
          }
        }
      });
      if (changes.length) {
        changes = [
          'Updates:',
          ...changes.map(s => `> ${s}`),
        ];
      }
    }
    const table = new AsciiTable();
    table.setHeading('Rank', 'Team Name', 'Score');
    currentTop10[i].forEach((team, rank) => table.addRow(parseInt(team.rank), team.name, team.score));
    embed.addField(title, ['```', table.toString(), '```', ...changes].join('\n'));
  });

  return embed;
};

const createTeamEmbed = (teamname, message, prevScoreboards) => {
  if (teamname === 'top10') {
    return createTop10Embed(message, prevScoreboards);
  }

  const current = scoreboards.map(scoreboard => scoreboard.find(team => team.name === teamname));
  const prev = prevScoreboards && prevScoreboards.length && prevScoreboards.map(scoreboard => scoreboard.find(team => team.name === teamname));

  const updates = current.map((result, i) => {
    if (!result) return {name: contests[i], value: ''};

    const changes = [];
    if (prev && prev[i]) {
      if (result.rank < prev[i].rank) {
        changes.push(`Team **${teamname.replace(/\*/g, '\\*')}** moved up the leaderboard from **rank ${prev[i].rank}** to **rank ${result.rank}**!`);
      }
      if (result.rank > prev[i].rank) {
        changes.push(`Team **${teamname.replace(/\*/g, '\\*')}** moved down the leaderboard from **rank ${prev[i].rank}** to **rank ${result.rank}** 😔`);
      }
      if (result.score > prev[i].score) {
        changes.push(`Team **${teamname.replace(/\*/g, '\\*')}**'s score improved from **${prev[i].score}** to **${result.score}**!`);
      }
      if (result.score < prev[i].score) {
        changes.push(`Team **${teamname.replace(/\*/g, '\\*')}**'s score decreased from **${prev[i].score}** to **${result.score}** ... but ... how ...?`);
      }
    } else {
      changes.push(`Team **${teamname.replace(/\*/g, '\\*')}** is on **rank ${result.rank}** of ${scoreboards[i].length} with score **${result.score}**.`);
    }
    if (changes.length > 0) {
      // Show the leaderboard around this team
      let rankFrom = parseInt(result.rank) - 4, rankTo = parseInt(result.rank) + 5;
      while (rankFrom < 1) {
        rankFrom++; rankTo++;
      }
      while (rankTo > scoreboards[i].length) {
        rankFrom--; rankTo--;
      }
      const table = new AsciiTable();
      table.setHeading('Rank', 'Team Name', 'Score');
      scoreboards[i].slice(rankFrom-1, rankTo).forEach((team) => table.addRow(parseInt(team.rank), team.name, team.score));
      changes.push('```', ...table.toString().split('\n'), '```');
      changes.push(`> Submission Date: ${result.timestamp}`);
    }
    return {
      name: contests[i],
      value: changes.join('\n'),
    };
  });

  const embed = new Discord.MessageEmbed()
    .setColor('#008891')
    .setTitle(`Updates for Team ${teamname}`)
    .setThumbnail('https://brihackathon.id/images/logo-bri-hackathon.png')
    .setDescription(message || '')
    .setFooter(`Last fetched at ${lastFetched}`);
  updates.forEach(update => {
    if (update.value) {
      embed.addField(update.name, update.value);
    } else if (!prevScoreboards) {
      // If this is new, i.e. just subscribed, then we should let them know that this team is missing.
      embed.addField(update.name, `Team ${teamname.replace(/\*/g, '\\*')} is not found in this competition.`);
    }
  });
  return embed;
};

const createHelpEmbed = (welcome = false) => {
  const embed = new Discord.MessageEmbed()
    .setColor('#008891')
    .setTitle('BRI Data Hackathon Leaderboard Bot')
    .setThumbnail('https://brihackathon.id/images/logo-bri-hackathon.png')
    .setFooter('Disclaimer: this bot is not affiliated with BRI or BRI Data Hackathon.')
    .addFields(
      {
        name: 'sub <teamname>',
        value: 'Get all rank/score updates on the specified team.',
      },
      {
        name: 'sub top10',
        value: 'Get all updates on top 10 leaderboard.',
      },
      {
        name: 'unsub <teamname|top10>',
        value: 'Stop getting updates on the specified team or top 10 leaderboard for "unsub top10".',
      },
      {
        name: 'top10',
        value: 'Show top 10 leaderboard at any time, without subscribing to realtime updates.',
      },
      {
        name: 'help',
        value: 'Show this.',
      },
      {
        name: 'Important Links',
        value: [
          'Homepage: https://brihackathon.id/',
          'Rules: https://brihackathon.id/page/syarat-dan-ketentuan',
          'People Analytics Contest Page: https://www.kaggle.com/c/bri-data-hackathon-pa',
          'Cash Ratio Optimization Contest Page: https://www.kaggle.com/c/bri-data-hackathon-cr-optimization',
        ].join('\n'),
      },
    );
  let description = [
    `All commands below are for direct messages. To use me in your server's channels, mention me before every commands. For example: **<@!${discord.user.id}> sub top10**.`,
  ];
  if (welcome) {
    description = [
      'Thanks for adding me! I will send you any updates on the changes in the leaderboard. To subscribe to changes to your team, use **sub <teamname>**.',
      '',
      ...description,
    ];
  }
  embed.setDescription(description.join('\n'));
  return embed;
};

const patterns = {
  sub: /^\s*(?:sub|subscribe)\s+(.*)\s*$/,
  unsub: /^\s*(?:unsub|unsubscribe)\s+(.*)\s*$/,
  top10: /^\s*(?:top10|scoreboard|leaderboard).*$/,
  help: /^\s*help.*$/,
};

discord.on('message', async message => {
  // ignore messages from self
  if (message.author.id === discord.user.id) return;

  let channelInfo = '{}';
  if (message.guild) {
    channelInfo = JSON.stringify({
      type: 'channel',
      channel: message.channel.name,
      channelId: message.channel.id,
      server: message.guild.name,
      serverId: message.guild.id,
      user: message.author.username,
      user_id: message.author.id,
    });
  } else {
    channelInfo = JSON.stringify({
      type: 'dm',
      user: message.author.username,
      user_id: message.author.id,
    });
  }
  console.log(channelInfo, 'got message:', message.content);

  const type = message.channel.type === 'dm' ? 'dm' : 'channel';
  const id = message.channel.id;

  let content = message.content;

  // one must mention me to respond in channel
  const mention = `<@!${discord.user.id}>`;
  let isMention = content.search(mention) !== -1;
  if (type === 'channel' && !isMention) return;

  if (isMention) {
    content = content.replace(new RegExp(mention, 'g'), '');
  }

  const {user, exists} = getUserById(id, type);
  if (!exists) {
    await message.channel.send(createHelpEmbed(true));
    await message.channel.send(createTop10Embed('You are automatically subscribed to changes to the top 10 leaderboard. To stop receiving updates, send me **unsub top10**'));
  }

  if (content.match(patterns.sub)) {
    const team = content.match(patterns.sub)[1];
    console.log(`User ${id} subscribed to ${team}`);
    if (!team) return;

    if (user.subscriptions.find(t => t === team)) {
      await message.channel.send(`You are already subscribed to ${team}`);
      await message.channel.send(createTeamEmbed(team));
      return;
    }
    user.subscriptions.push(team);
    saveUsers();
    await message.channel.send(createTeamEmbed(team, [
      team === 'top10'
        ? 'You will be notified on any updates on top 10 leaderboard.'
        : `You will be notified on any score/rank updates on team ${team}.`,
      `Send me **unsub ${team}** to unsubscribe`,
    ].join('\n')));
  }

  else if (content.match(patterns.unsub)) {
    const team = content.match(patterns.unsub)[1];
    console.log(`User ${id} unsubscribed to ${team}`);
    if (!team) return;

    const idx = user.subscriptions.findIndex(t => t === team);
    if (idx === -1) {
      await message.channel.send(`You are not subscribed to team ${team}`);
    } else {
      user.subscriptions.splice(idx, 1);
      saveUsers();
      if (team === 'top10') {
        await message.channel.send('You will not get notified on any updates on top 10 leaderboard. To see the top 10 at any time, send me **top10**.');
      } else {
        await message.channel.send(`You will not get notified on any updates on team ${team}`);
      }
    }
  }

  else if (content.match(patterns.top10)) {
    await message.channel.send(createTop10Embed());
  }

  else if (content.match(patterns.help)) {
    await message.channel.send(createHelpEmbed());
  }

  // show help if we get mentioned or in dm but found no matching commands
  else if ((isMention || type === 'dm') && exists) {
    await message.channel.send(createHelpEmbed());
  }
});

const updateLoop = async () => {
  try {
    console.log('started fetching scoreboard...');

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

    console.log('finished fetching scoreboard');

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

    lastFetched = new Date().toISOString();
    const prevScoreboards = scoreboards;

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
    await saveScoreboards();

    // Notify individual teams subscriptions.
    // Not proud of this; current and prev here are just for comparison,
    // and they will be calculated again in createTeamEmbed.
    // But it should not matter unless there are thousands of users so yeah whatever.
    users.forEach(user => {
      user.subscriptions.forEach(teamname => {
        if (teamname === 'top10') return;
        const current = scoreboards.map(scoreboard => scoreboard.find(team => team.name === teamname));
        const prev = prevScoreboards && prevScoreboards.map(scoreboard => scoreboard.find(team => team.name === teamname));

        if (JSON.stringify(current) !== JSON.stringify(prev)) {
          notify(createTeamEmbed(teamname, '', prevScoreboards), user.id);
        }
      });
    });

    // Notify top 10 changes.
    const currentTop10 = scoreboards.map(scoreboard => scoreboard.slice(0, 10));
    const prevTop10 = prevScoreboards.map(scoreboard => scoreboard.slice(0, 10));

    if (JSON.stringify(currentTop10) !== JSON.stringify(prevTop10)) {
      const embed = createTop10Embed('', prevScoreboards);
      users.forEach(user => {
        if (user.subscriptions.find(s => s === 'top10')) {
          notify(embed, user.id);
        }
      });

      // Dump the scoreboards.
      const timestamp = lastFetched.replace(/\-/g, '').replace(/T/g, '_').replace(/\:/g, '').replace(/\.\d+Z$/g, '');
      contests.forEach(async (title, i) => {
        if (JSON.stringify(scoreboards[i]) === JSON.stringify(prevScoreboards[i])) return;
        const csvWriter = createObjectCsvWriter({
          path: `dumps/scoreboard_${title.toLowerCase().replace(/ /g, '_')}_${timestamp}.csv`,
          header: [
            {id: 'rank', title: 'rank'},
            {id: 'name', title: 'team_name'},
            {id: 'score', title: 'score'},
            {id: 'timestamp', title: 'submission_date'},
          ],
        });
        await csvWriter.writeRecords(scoreboards[i]);
      });
    }
  } catch (e) {
    console.error('Uncaught exception:', e);
    notifyError(`Uncaught Exception: ${e}`);
  }
};

// initialize dumps folder
if (!fs.existsSync('dumps')) {
  fs.mkdirSync('dumps');
}

updateLoop();
setInterval(updateLoop, 60000);
