import * as discord from 'discord.js'

export interface CommandInterface {
    data: discord.SlashCommandBuilder
    execute: (interaction: discord.CommandInteraction) => Promise<void>
}
