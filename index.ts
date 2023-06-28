/** @file Entrypoint for the Discord bot. */
import * as discord from 'discord.js'

import * as chat from './chat'
import * as database from './database'
import * as newtype from './newtype'

import CONFIG from './config.json' assert { type: 'json' }

// =================
// === Constants ===
// =================

/** The maximum number of messages to fetch when opening a new thread. */
const MESSAGE_HISTORY_LENGTH = 25

// ===========
// === Bot ===
// ===========

// These should not be methods, to help inlining.
function getMessageId(message: discord.Message | discord.PartialMessage) {
    return newtype.asNewtype<database.MessageId>(message.id)
}

function getMessageThreadId(message: discord.Message | discord.PartialMessage) {
    return newtype.asNewtype<database.ThreadId>(message.channelId)
}

function getMessageAuthorId(message: discord.Message) {
    return newtype.asNewtype<database.DiscordUserId>(message.author.id)
}

function getThreadId(thread: discord.ThreadChannel) {
    return newtype.asNewtype<database.ThreadId>(thread.id)
}

class Bot {
    private readonly client = new discord.Client({
        intents: [
            discord.GatewayIntentBits.GuildMessages,
            /* Required for registering staff. */
            discord.GatewayIntentBits.DirectMessages,
            discord.GatewayIntentBits.MessageContent,
        ],
        partials: [discord.Partials.Channel],
    })
    private readonly db: database.Database
    private threads: Record<
        string,
        discord.PrivateThreadChannel | discord.PublicThreadChannel | null
    > = {}
    private guild!: discord.Guild
    private staffRole!: discord.Role
    private channel!: discord.TextChannel
    private webhook!: discord.Webhook

    // This is a parameter property, so it is only ever shadowed in the constructor.
    // eslint-disable-next-line @typescript-eslint/no-shadow
    constructor(private readonly config: typeof CONFIG, private readonly chat: chat.Chat) {
        this.db = new database.Database(config.storageLocation)
    }

    /** This MUST be called and awaited before doing anything with the bot. */
    async start() {
        this.client.on(discord.Events.MessageCreate, this.onDiscordMessageCreate.bind(this))
        this.client.on(discord.Events.MessageUpdate, this.onDiscordMessageUpdate.bind(this))
        // Consider handling thread delete events as well.
        await this.client.login(this.config.discordToken)
        this.chat.onMessage(this.onMessage.bind(this))
        this.guild = await this.client.guilds.fetch(CONFIG.discordServerId)
        const staffRole = await this.guild.roles.fetch(CONFIG.discordStaffRoleId)
        const channelId = this.config.discordChannelId
        const channel = await this.client.channels.fetch(channelId)
        if (channel == null) {
            throw new Error(`No channel with ID '${channelId}' exists.`)
        } else if (channel.type !== discord.ChannelType.GuildText) {
            throw new Error(`The channel with ID '${channelId}' is not a guild text channel.`)
        } else if (staffRole == null) {
            throw new Error(`The staff role (id '${CONFIG.discordStaffRoleId}') was not found.`)
        } else {
            this.staffRole = staffRole
            this.channel = channel
            let webhook = (await channel.fetchWebhooks()).find(
                fetchedWebhook => fetchedWebhook.token != null
            )
            if (webhook == null) {
                webhook = await channel.createWebhook({ name: 'Enso Support' })
            }
            this.webhook = webhook
            return
        }
    }

    async getThread(threadId: chat.ThreadId) {
        if (threadId in this.threads) {
            return this.threads[threadId] ?? null
        } else {
            const thread = await this.client.channels.fetch(threadId)
            let result: discord.PrivateThreadChannel | discord.PublicThreadChannel | null
            if (thread == null) {
                // May cause a race condition. Testing may be needed.
                console.error(`No thread with ID '${threadId}' exists.`)
                result = null
            } else if (!thread.isThread()) {
                console.error(`The channel with ID '${threadId}' is not a thread.`)
                result = null
            } else if (!thread.isTextBased()) {
                console.error(`The channel with ID '${threadId}' is not a text channel.`)
                result = null
            } else {
                result = thread
            }
            this.threads[threadId] = result
            return result
        }
    }

    async onDiscordMessageCreate(message: discord.Message) {
        const threadId = getMessageThreadId(message)
        if (
            message.channel.isThread() &&
            this.db.hasThread(threadId) &&
            message.type === discord.MessageType.Default &&
            // This is required so that the bot does not try to add its own message to the DB,
            // which will violate a uniqueness constraint.
            !message.author.bot &&
            !message.author.system
        ) {
            const authorId = getMessageAuthorId(message)
            let staff = this.db.getUserByDiscordId(authorId)
            if (staff == null) {
                await message.delete()
                const author = await this.client.users.fetch(authorId)
                await author.send(
                    `You are not registered with ${CONFIG.botName}.\n` +
                        `Please send a message with your full name and profile picture.\n` +
                        `Note that the picture will be stretched into a square and cropped ` +
                        `to a circle on the client side.`
                )
                // This is fine, as it is an exceptional situation.
                // eslint-disable-next-line no-restricted-syntax
                return
            }
            const messageId = getMessageId(message)
            this.db.createMessage({
                discordMessageId: messageId,
                discordThreadId: getMessageThreadId(message),
                discordAuthorId: getMessageAuthorId(message),
                content: message.content,
                createdAt: message.createdTimestamp,
                editedAt: message.createdTimestamp,
            })
            const thread = this.db.updateThread(threadId, oldThread => ({
                ...oldThread,
                lastMessageSentId: getMessageId(message),
            }))
            const user = this.db.getUser(thread.userId)
            if (threadId === user.currentThreadId) {
                await chat.Chat.default().send(thread.userId, {
                    type: chat.ChatMessageDataType.serverMessage,
                    timestamp: message.createdTimestamp,
                    id: newtype.asNewtype<database.MessageId>(message.id),
                    content: message.content,
                    authorAvatar: staff.avatarUrl,
                    authorName: staff.name,
                })
            }
        } else if (message.channel.isDMBased() && message.type === discord.MessageType.Default) {
            const guildUser = await this.guild.members.fetch(getMessageAuthorId(message))
            if (guildUser.roles.cache.has(this.staffRole.id)) {
                const avatar = message.attachments.at(0)
                if (message.attachments.size !== 1 || avatar == null) {
                    await message.channel.send('You must upload exactly one photo for your avatar.')
                } else if (/^\s*$/.test(message.content)) {
                    await message.channel.send('You must send your full name with your image.')
                } else if (message.content.includes('\n')) {
                    await message.channel.send('Your name must not span multiple names.')
                } else {
                    const authorId = getMessageAuthorId(message)
                    const userId: string = authorId
                    const dbUserId = newtype.asNewtype<database.UserId>(userId)
                    if (this.db.getUserByDiscordId(authorId) == null) {
                        // This is a new user.
                        this.db.createUser({
                            id: dbUserId,
                            discordId: authorId,
                            name: message.content,
                            avatarUrl: avatar.proxyURL,
                            currentThreadId: null,
                        })
                        await message.channel.send('Created user profile.')
                    } else {
                        this.db.updateUser(dbUserId, user => ({
                            ...user,
                            name: message.content,
                            avatarUrl: avatar.proxyURL,
                        }))
                        // This is an existing user updating their name and/or profile picture.
                        await message.channel.send('Updated user profile.')
                    }
                }
            }
        }
    }

    async onDiscordMessageUpdate(
        _oldMessage: discord.Message | discord.PartialMessage,
        newMessage: discord.Message | discord.PartialMessage
    ) {
        const threadId = getMessageThreadId(newMessage)
        if (newMessage.channel.isThread() && this.db.hasThread(threadId)) {
            const messageId = getMessageId(newMessage)
            this.db.updateMessage(messageId, message => ({
                ...message,
                // This will never be `null` as this event is always emitted with an edited message.
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                editedAt: newMessage.editedTimestamp!,
            }))
            if (newMessage.content == null) {
                console.error(
                    `The content of the updated message with ID '${newMessage.id}' is 'null'.`
                )
            } else if (newMessage.editedTimestamp == null) {
                console.error(
                    `The timestamp of the updated message with ID '${newMessage.id}' is 'null'.`
                )
            } else {
                const thread = this.db.getThread(threadId)
                const user = this.db.getUser(thread.userId)
                if (threadId === user.currentThreadId) {
                    await chat.Chat.default().send(thread.userId, {
                        type: chat.ChatMessageDataType.serverEditedMessage,
                        timestamp: newMessage.editedTimestamp,
                        id: newtype.asNewtype<database.MessageId>(newMessage.id),
                        content: newMessage.content,
                    })
                }
            }
        }
    }

    async sendThread(userId: database.UserId, threadId: database.ThreadId | null) {
        if (threadId != null) {
            const thread = this.db.getThread(threadId)
            const messages = this.db.getThreadLastMessages(threadId, MESSAGE_HISTORY_LENGTH)
            await this.chat.send(userId, {
                type: chat.ChatMessageDataType.serverThread,
                id: thread.discordThreadId,
                title: thread.title,
                messages: messages.flatMap(
                    (
                        dbMessage
                    ): (
                        | chat.ChatServerMessageMessageData
                        | chat.ChatServerReplayedMessageMessageData
                    )[] => {
                        if (dbMessage.discordAuthorId == null) {
                            // It is a message from the user to staff.
                            const message: chat.ChatServerReplayedMessageMessageData = {
                                type: chat.ChatMessageDataType.serverReplayedMessage,
                                id: dbMessage.discordMessageId,
                                content: dbMessage.content,
                                timestamp: dbMessage.createdAt,
                            }
                            return [message]
                        } else {
                            let staff = this.db.getUserByDiscordId(dbMessage.discordAuthorId)
                            if (staff == null) {
                                // This should never happen, as staff messages are deleted
                                // if the staff member is not registered.
                                return []
                            } else {
                                const message: chat.ChatServerMessageMessageData = {
                                    type: chat.ChatMessageDataType.serverMessage,
                                    id: dbMessage.discordMessageId,
                                    content: dbMessage.content,
                                    authorAvatar: staff.avatarUrl,
                                    authorName: staff.name,
                                    timestamp: dbMessage.createdAt,
                                }
                                return [message]
                            }
                        }
                    }
                ),
            })
        }
    }

    async onMessage(
        userId: database.UserId,
        message: chat.ChatClientMessageData | chat.ChatInternalMessageData
    ) {
        switch (message.type) {
            case chat.ChatMessageDataType.internalAuthenticate: {
                if (!this.db.hasUser(message.userId)) {
                    this.db.createUser({
                        id: message.userId,
                        discordId: null,
                        name: message.userName,
                        avatarUrl: null,
                        currentThreadId: null,
                    })
                }
                break
            }
            case chat.ChatMessageDataType.authenticate: {
                const threads = this.db.getUserThreads(userId)
                await this.chat.send(userId, {
                    type: chat.ChatMessageDataType.serverThreads,
                    threads: threads.map(thread => ({
                        id: thread.discordThreadId,
                        title: thread.title,
                        hasUnreadMessages: thread.lastMessageReadId !== thread.lastMessageSentId,
                    })),
                })
                await this.sendThread(userId, this.db.getUser(userId).currentThreadId)
                break
            }
            case chat.ChatMessageDataType.newThread: {
                const thread = await this.channel.threads.create({ name: message.title })
                const user = this.db.updateUser(userId, oldUser => ({
                    ...oldUser,
                    currentThreadId: getThreadId(thread),
                }))
                const discordMessage = await this.webhook.send({
                    threadId: thread.id,
                    username: user.name,
                    ...(user.avatarUrl != null ? { avatarURL: user.avatarUrl } : {}),
                    content: message.content,
                })
                const messageId = getMessageId(discordMessage)
                const threadId = getMessageThreadId(discordMessage)
                this.db.createThread({
                    discordThreadId: getThreadId(thread),
                    userId: userId,
                    title: message.title,
                    lastMessageSentId: messageId,
                    lastMessageReadId: messageId,
                })
                this.db.createMessage({
                    discordMessageId: messageId,
                    discordThreadId: threadId,
                    // The user using the web frontend is the author of this message.
                    discordAuthorId: null,
                    content: discordMessage.content,
                    createdAt: discordMessage.createdTimestamp,
                    editedAt: discordMessage.createdTimestamp,
                })
                await chat.Chat.default().send(user.id, {
                    type: chat.ChatMessageDataType.serverThread,
                    id: threadId,
                    title: message.title,
                    messages: [
                        {
                            type: chat.ChatMessageDataType.serverReplayedMessage,
                            id: messageId,
                            content: message.content,
                            timestamp: discordMessage.createdTimestamp,
                        },
                    ],
                })
                break
            }
            case chat.ChatMessageDataType.renameThread: {
                const thread = await this.getThread(message.threadId)
                if (thread != null) {
                    await thread.setName(message.title)
                    this.db.updateThread(message.threadId, oldThread => ({
                        ...oldThread,
                        title: message.title,
                    }))
                }
                break
            }
            case chat.ChatMessageDataType.switchThread: {
                this.db.updateUser(userId, user => ({ ...user, currentThreadId: message.threadId }))
                await this.sendThread(userId, message.threadId)
                break
            }
            case chat.ChatMessageDataType.message: {
                const thread = await this.getThread(message.threadId)
                const user = this.db.getUser(userId)
                if (thread != null) {
                    const newMessage = await this.webhook.send({
                        threadId: message.threadId,
                        username: user.name,
                        ...(user.avatarUrl != null ? { avatarURL: user.avatarUrl } : {}),
                        content: message.content,
                    })
                    this.db.createMessage({
                        discordMessageId: getMessageId(newMessage),
                        discordThreadId: getMessageThreadId(newMessage),
                        // The user using the web frontend is the author of this message.
                        discordAuthorId: null,
                        content: newMessage.content,
                        createdAt: newMessage.createdTimestamp,
                        editedAt: newMessage.createdTimestamp,
                    })
                }
                break
            }
            case chat.ChatMessageDataType.reaction: {
                const thread = await this.getThread(message.threadId)
                if (thread != null) {
                    const discordMessage = await thread.messages.fetch(message.messageId)
                    await discordMessage.react(message.reaction)
                }
                break
            }
            case chat.ChatMessageDataType.markAsRead: {
                this.db.updateThread(message.threadId, thread => ({
                    ...thread,
                    lastMessageReadId: message.messageId,
                }))
                break
            }
        }
    }
}

const BOT = new Bot(CONFIG, chat.Chat.default())
void BOT.start()
