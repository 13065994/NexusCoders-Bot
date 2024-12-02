const logger = require('../utils/logger');

const config = require('../config');

const { executeCommand, onReply, onChat } = require('./commandHandler');

const eventHandler = require('./eventHandler');

const messageCount = new Map();

const typingStates = new Map();

const recordingStates = new Map();

const formatters = {
    box: (text) => `${text}`,

    footer: () => ``
};

function handleSpam(jid, sock) {

    if (!config.features?.antiSpam?.enabled) return false;

    const now = Date.now();

    const userData = messageCount.get(jid) || { count: 0, lastReset: now };

    if (now - userData.lastReset > (config.features?.antiSpam?.interval || 30000)) {

        userData.count = 0;

        userData.lastReset = now;

    }

    userData.count++;

    messageCount.set(jid, userData);

    return userData.count > (config.features?.antiSpam?.maxMessages || 10);

}

async function updatePresence(sock, jid, type) {

    try {

        await sock.presenceSubscribe(jid);

        await sock.sendPresenceUpdate(type, jid);

    } catch (error) {

        logger.error(`Error updating presence (${type}):`, error);

    }

}

async function simulatePresence(sock, jid) {

    const { autoTyping, autoRecord, autoOnline } = config.features.presence;

    

    if (autoOnline) {

        await updatePresence(sock, jid, 'available');

    }

    

    if (autoTyping && !typingStates.get(jid)) {

        typingStates.set(jid, true);

        await updatePresence(sock, jid, 'composing');

        

        setTimeout(async () => {

            await updatePresence(sock, jid, 'paused');

            typingStates.delete(jid);

        }, 3000);

    }

    

    if (autoRecord && !recordingStates.get(jid)) {

        recordingStates.set(jid, true);

        await updatePresence(sock, jid, 'recording');

        

        setTimeout(async () => {

            await updatePresence(sock, jid, 'paused');

            recordingStates.delete(jid);

        }, 5000);

    }

}

async function handleMessage(sock, message) {

    try {

        if (!message?.message) return;

        const jid = message.key.remoteJid;

        if (!jid) return;

        const sender = message.key.participant || message.key.remoteJid;

        if (config.features?.autoRead === true) {

            await sock.readMessages([message.key]);

        }

        if (handleSpam(sender, sock)) {

            await sock.sendMessage(jid, {
                text: formatters.box('SPAM DETECTED') + '\n' +
                      '│ 🚫 Please slow down!\n' +
                      '│ ⏰ Try again in a few seconds\n' +
                      '╰───────────────────────' +
                      formatters.footer()
    },   {  quoted: message });
            return;

        }

        let messageText = '';

        const msg = message.message;

        if (msg.conversation) {

            messageText = msg.conversation;

        } else if (msg.extendedTextMessage) {

            messageText = msg.extendedTextMessage.text;

        } else if (msg.imageMessage) {

            messageText = msg.imageMessage.caption || '';

        } else if (msg.videoMessage) {

            messageText = msg.videoMessage.caption || '';

        }

        const quotedMsg = msg.extendedTextMessage?.contextInfo?.quotedMessage;

        const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';

        if (!messageText && !quotedText) return;
        
        if (messageText.toLowerCase() === 'prefix') {
            await sock.sendMessage(jid, {
                text: formatters.box('╭╾╾╾╾╾╾╾╾❍') + '\n' +
                      '┃⭖𝗦𝗬𝗦𝗧𝗘𝗠 𝗣𝗥𝗘𝗙𝗜𝗫'
                      '┣➤ _*${config.bot.prefix}*_'
                      '┃⭖𝗖𝗛𝗔𝗧 𝗣𝗥𝗘𝗙𝗜𝗫'
                      '┣➤ _*' + config.bot.prefix + '*_'
                      '┃⭖ _𝚃𝚢𝚙𝚎 *' +config.bot.prefix' + '𝚖𝚎𝚗𝚞* 𝚝𝚘 𝚜𝚎𝚎 𝚕𝚒𝚜𝚝_'
                      '╰╾╾╾╾╾╾╾╾╾╾╾❍'
✓ 𝗡𝗘𝗫𝗨𝗦-𝗠𝗗 𝗩𝟭
                      formatters.footer()
    },   {  quoted: message });
            return;
}

        if (messageText === config.bot.prefix) {

          await sock.sendMessage(jid, {
                text: formatters.box('╭╾╾ WELCOME TO NEXUS v1❍') + '\n' +
                      '│ 🤖 Bot Prefix: ' + config.bot.prefix + '\n' +
                      '│ 📚 Commands: ' + config.bot.prefix + 'menu\n' +
                      '│ ⏰ Uptime: 24/7\n' +
                      '╰──────────────────' +
                      formatters.footer()
    },   {  quoted: message });
            return;

        }

        const isCommand = messageText.startsWith(config.bot.prefix);

        const isReply = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (isCommand) {

            await simulatePresence(sock, jid);

            const [command, ...args] = messageText.slice(config.bot.prefix.length).trim().split(' ');

            if (command) {

                await executeCommand(sock, message, command.toLowerCase(), args);

            }

        }

        if (isReply) {

            await onReply(sock, message, jid, sender);

        } else {

            await onChat(sock, message, jid, sender);

        }

        if (config.features?.presence?.autoTyping || config.features?.presence?.autoRecord) {

            setTimeout(async () => {

                try {

                    await sock.sendPresenceUpdate('paused', jid);

                } catch (error) {}

            }, 1000);

        }

    } catch (error) {

        logger.error('Error in message handler:', error);

    }

}

async function handleGroupParticipantsUpdate(sock, update) {

    try {

        const { id, participants, action } = update;

        if (!id || !participants || !action) return;

        switch (action) {

            case 'add':

                for (const participant of participants) {

                    await eventHandler.handleEvent('groupMemberJoin', sock, id, participant);

                }

                break;

            case 'remove':

                for (const participant of participants) {

                    await eventHandler.handleEvent('groupMemberLeave', sock, id, participant);

                }

                break;

            case 'promote':

                await eventHandler.handleEvent('groupMemberPromote', sock, id, participants);

                break;

            case 'demote':

                await eventHandler.handleEvent('groupMemberDemote', sock, id, participants);

                break;

        }

    } catch (error) {

        logger.error('Error in group participants handler:', error);

    }

}

async function handleGroupUpdate(sock, update) {

    try {

        const { id, subject, desc, restrict, announce } = update;

        if (!id) return;

        const updates = {};

        let hasUpdates = false;

        if (subject !== undefined) {

            updates.subject = subject;

            hasUpdates = true;

            await eventHandler.handleEvent('groupSubjectUpdate', sock, id, subject);

        }

        if (desc !== undefined) {

            updates.desc = desc;

            hasUpdates = true;

            await eventHandler.handleEvent('groupDescriptionUpdate', sock, id, desc);

        }

        if (restrict !== undefined || announce !== undefined) {

            updates.restrict = restrict;

            updates.announce = announce;

            hasUpdates = true;

            await eventHandler.handleEvent('groupSettings', sock, id, { restrict, announce });

        }

    } catch (error) {

        logger.error('Error in group update handler:', error);

    }

}

module.exports = {

    handleMessage,

    handleGroupParticipantsUpdate,

    handleGroupUpdate

};
