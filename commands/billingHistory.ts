import * as discord from 'discord.js'
import * as commandInterface from '../commandInterface'

const COMMAND: commandInterface.CommandInterface = {
    data: new discord.SlashCommandBuilder()
        .setName('billing-history')
        .setDescription('Shows billing history in Discord only, and not in the customer chat.'),
    async execute(interaction) {},
}

export default COMMAND
