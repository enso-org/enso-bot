import * as discord from 'discord.js'

import * as commandInterface from '../commandInterface'
import * as customerChat from '../chat'

const COMMAND: commandInterface.CommandInterface = {
    data: new discord.SlashCommandBuilder()
        .setName('send-pricing-info')
        .setDescription('Sends pricing information in the customer chat only, and not in Discord.'),
    async execute(interaction) {
        customerChat.Chat.default().sendCustomerMessage(interaction.channelId, {
            type: 'html-message',
            content: 'TODO',
        })
    },
}

export default COMMAND
