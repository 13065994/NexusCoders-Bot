const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config');
const User = require('../../models/user');

const genAI = new GoogleGenerativeAI('AIzaSyAkq3h7r2VN_LKJxc01jK9jslW8zzhlkuM');
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

let chatSessions = new Map();

module.exports = {
    name: 'gemini',
    aliases: ['gm'],
    category: 'ai',
    description: 'Chat with Gemini AI',
    usage: 'gemini <query>',
    cooldown: 3,

    async execute(sock, message, args, user) {
        const jid = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (args[0]?.toLowerCase() === 'chat') {
            const mode = args[1]?.toLowerCase();
            if (mode === 'on' || mode === 'off') {
                user.chatCommandName = mode === 'on' ? this.name : null;
                if (mode === 'on') {
                    user.chatData = { history: [] };
                    chatSessions.set(sender, model.startChat());
                } else {
                    user.chatData = null;
                    chatSessions.delete(sender);
                }
                await user.save();
                
                await sock.sendMessage(jid, {
                    text: `🤖 Gemini chat mode turned ${mode.toUpperCase()}`,
                    quoted: message
                });
                return;
            }
        }

        const query = args.join(' ') || (quoted?.conversation || quoted?.extendedTextMessage?.text || '');
        
        if (!query) {
            await sock.sendMessage(jid, {
                text: `❌ Please provide a query or use "chat on/off" to toggle chat mode`,
                quoted: message
            });
            return;
        }

        try {
            const result = await model.generateContent(query);
            const response = result.response.text();
            
            await sock.sendMessage(jid, {
                text: response,
                quoted: message
            });
        } catch (error) {
            await sock.sendMessage(jid, {
                text: `❌ Error: ${error.message}`,
                quoted: message
            });
        }
    },

    async onReply(sock, message, user) {
        const jid = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const replyMsg = message.message?.conversation || 
                        message.message?.extendedTextMessage?.text || '';

        if (sender !== user.id) {
            return;
        }

        try {
            const result = await model.generateContent(replyMsg);
            const response = result.response.text();
            
            await sock.sendMessage(jid, {
                text: response,
                quoted: message
            });
        } catch (error) {
            await sock.sendMessage(jid, {
                text: `❌ Error: ${error.message}`,
                quoted: message
            });
        }
    },

    async onChat(sock, message, user) {
        const jid = message.key.remoteJid;
        const sender = message.key.participant || message.key.remoteJid;
        const chatMsg = message.message?.conversation || 
                       message.message?.extendedTextMessage?.text || '';

        if (!chatSessions.has(sender)) {
            chatSessions.set(sender, model.startChat());
        }

        if (chatMsg.toLowerCase() === 'exit') {
            user.chatCommandName = null;
            user.chatData = null;
            chatSessions.delete(sender);
            await user.save();

            await sock.sendMessage(jid, {
                text: '👋 Gemini chat session ended',
                quoted: message
            });
            return;
        }

        try {
            const chat = chatSessions.get(sender);
            const result = await chat.sendMessage(chatMsg);
            const response = result.response.text();
            
            user.chatData.history.push({ role: 'user', content: chatMsg });
            user.chatData.history.push({ role: 'assistant', content: response });
            await user.save();

            await sock.sendMessage(jid, {
                text: response,
                quoted: message
            });
        } catch (error) {
            await sock.sendMessage(jid, {
                text: `❌ Error: ${error.message}`,
                quoted: message
            });
            
            user.chatCommandName = null;
            user.chatData = null;
            chatSessions.delete(sender);
            await user.save();
        }
    }
};
