/** @file Entrypoint for the Discord bot. */
import * as discord from 'discord.js'

import * as chat from './chat'
import * as database from './database'
import * as newtype from './newtype'
import * as schema from './schema'

import CONFIG from './config.json' assert { type: 'json' }

// =================
// === Constants ===
// =================

/** The maximum number of messages to fetch when opening a new thread. */
const MESSAGE_HISTORY_LENGTH = 25
/** The port on which the WebSocket server will be started. */
const WEBSOCKET_PORT = CONFIG.websocketPort

// ===========
// === Bot ===
// ===========

// These should not be methods, to help inlining.
function getMessageId(message: discord.Message | discord.PartialMessage) {
    return newtype.asNewtype<schema.MessageId>(message.id)
}

function getMessageThreadId(message: discord.Message | discord.PartialMessage) {
    return newtype.asNewtype<schema.ThreadId>(message.channelId)
}

function getMessageAuthorId(message: discord.Message) {
    return newtype.asNewtype<schema.DiscordUserId>(message.author.id)
}

function getThreadId(thread: discord.ThreadChannel) {
    return newtype.asNewtype<schema.ThreadId>(thread.id)
}

class Bot {
    private readonly client = new discord.Client({
        intents: [
            /** This is required to get guild info, which is required for listening to all
             * threads. */
            discord.GatewayIntentBits.Guilds,
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
    private channel!: discord.TextChannel
    private webhook!: discord.Webhook

    // This is a parameter property, so it is only ever shadowed in the constructor.
    // eslint-disable-next-line @typescript-eslint/no-shadow
    constructor(private readonly config: typeof CONFIG, private readonly chat: chat.Chat) {
        this.db = new database.Database(config.storageLocation)
    }

    /** This MUST be called and awaited before doing anything with the bot. */
    async start() {
        this.client.on(discord.Events.MessageCreate, async message => {
            try {
                await this.onDiscordMessageCreate(message)
            } catch (error) {
                console.error(error)
            }
        })
        this.client.on(discord.Events.MessageUpdate, async (oldMessage, newMessage) => {
            try {
                await this.onDiscordMessageUpdate(oldMessage, newMessage)
            } catch (error) {
                console.error(error)
            }
        })
        // Consider handling thread delete events as well.
        await this.client.login(this.config.discordToken)
        this.chat.onMessage(async (userId, message) => {
            try {
                await this.onMessage(userId, message)
            } catch (error) {
                console.error(error)
            }
        })
        this.guild = await this.client.guilds.fetch({ guild: CONFIG.discordServerId, force: true })
        const channelId = this.config.discordChannelId
        const channel = await this.client.channels.fetch(channelId)
        if (channel == null) {
            throw new Error(`No channel with ID '${channelId}' exists.`)
        } else if (channel.type !== discord.ChannelType.GuildText) {
            throw new Error(`The channel with ID '${channelId}' is not a guild text channel.`)
        } else {
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
        if (message.author.bot || message.author.system) {
            // Ignore automated messages.
        } else if (
            message.channel.isThread() &&
            this.db.hasThread(threadId) &&
            message.type === discord.MessageType.Default
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
                await chat.Chat.default(WEBSOCKET_PORT).send(thread.userId, {
                    type: chat.ChatMessageDataType.serverMessage,
                    id: newtype.asNewtype<schema.MessageId>(message.id),
                    authorAvatar: staff.avatarUrl,
                    authorName: staff.name,
                    content: message.content,
                    reactions: [],
                    timestamp: message.createdTimestamp,
                    editedTimestamp: null,
                })
            }
        } else if (message.channel.isDMBased() && message.type === discord.MessageType.Default) {
            const guildUser = await this.guild.members.fetch(getMessageAuthorId(message))
            if (guildUser.roles.cache.has(CONFIG.discordStaffRoleId)) {
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
                    const dbUserId = newtype.asNewtype<schema.UserId>(userId)
                    if (this.db.getUserByDiscordId(authorId) == null) {
                        // This is a new user.
                        this.db.createUser({
                            id: dbUserId,
                            discordId: authorId,
                            email: null,
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
                    await chat.Chat.default(WEBSOCKET_PORT).send(thread.userId, {
                        type: chat.ChatMessageDataType.serverEditedMessage,
                        timestamp: newMessage.editedTimestamp,
                        id: newtype.asNewtype<schema.MessageId>(newMessage.id),
                        content: newMessage.content,
                    })
                }
            }
        }
    }

    async sendThread(
        userId: schema.UserId,
        threadId: schema.ThreadId | null,
        requestType: chat.ChatServerThreadRequestType,
        getBefore: schema.MessageId | null
    ) {
        if (threadId != null) {
            const thread = this.db.getThread(threadId)
            const messages = this.db.getThreadLastMessages(
                threadId,
                MESSAGE_HISTORY_LENGTH + 1,
                getBefore
            )
            const firstMessage = messages[0]
            const lastMessage = messages[messages.length - 1]
            const reactions =
                firstMessage != null && lastMessage != null
                    ? this.db
                          .getReactions(
                              threadId,
                              firstMessage.discordMessageId,
                              lastMessage.discordMessageId
                          )
                          .reduce<Record<schema.MessageId, database.ReactionSymbol[]>>(
                              (mapping, reaction) => {
                                  const reactionsForMessage = (mapping[reaction.discordMessageId] =
                                      mapping[reaction.discordMessageId] ?? [])
                                  reactionsForMessage.push(reaction.reaction)
                                  return mapping
                              },
                              {}
                          )
                    : {}
            const isAtBeginning = messages.length <= MESSAGE_HISTORY_LENGTH
            await this.chat.send(userId, {
                type: chat.ChatMessageDataType.serverThread,
                requestType,
                id: thread.discordThreadId,
                title: thread.title,
                isAtBeginning,
                messages: messages
                    .slice(-MESSAGE_HISTORY_LENGTH)
                    .flatMap(
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
                                        reactions: reactions[dbMessage.discordMessageId] ?? [],
                                        authorAvatar: staff.avatarUrl,
                                        authorName: staff.name,
                                        timestamp: dbMessage.createdAt,
                                        editedTimestamp:
                                            dbMessage.editedAt !== dbMessage.createdAt
                                                ? dbMessage.editedAt
                                                : null,
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
        userId: schema.UserId,
        message: chat.ChatClientMessageData | chat.ChatInternalMessageData
    ) {
        switch (message.type) {
            case chat.ChatMessageDataType.internalAuthenticate: {
                if (!this.db.hasUser(message.userId)) {
                    this.db.createUser({
                        id: message.userId,
                        discordId: null,
                        email: null,
                        name: message.userName,
                        avatarUrl: null,
                        currentThreadId: null,
                    })
                }
                break
            }
            case chat.ChatMessageDataType.internalAuthenticateAnonymously: {
                if (!this.db.hasUser(message.userId)) {
                    this.db.createUser({
                        id: message.userId,
                        discordId: null,
                        email: message.email,
                        name: `${message.email}`,
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
                await this.sendThread(
                    userId,
                    this.db.getUser(userId).currentThreadId,
                    chat.ChatMessageDataType.authenticate,
                    null
                )
                break
            }
            case chat.ChatMessageDataType.authenticateAnonymously: {
                // Do not send any message history.
                break
            }
            case chat.ChatMessageDataType.historyBefore: {
                const user = this.db.getUser(userId)
                if (user.email) break // The user is chatting from the website, which does not support history.
                await this.sendThread(
                    userId,
                    this.db.getUser(userId).currentThreadId,
                    message.type,
                    message.messageId
                )
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
                await chat.Chat.default(WEBSOCKET_PORT).send(user.id, {
                    type: chat.ChatMessageDataType.serverThread,
                    requestType: chat.ChatMessageDataType.newThread,
                    id: threadId,
                    title: message.title,
                    isAtBeginning: true,
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
                await this.sendThread(userId, message.threadId, message.type, null)
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
            case chat.ChatMessageDataType.reaction:
            case chat.ChatMessageDataType.removeReaction: {
                const threadId = this.db.getUser(userId).currentThreadId
                const thread = threadId != null ? await this.getThread(threadId) : null
                if (thread != null) {
                    const discordMessage = await thread.messages.fetch(message.messageId)
                    const isAdding = message.type === chat.ChatMessageDataType.reaction
                    if (isAdding) {
                        await discordMessage.react(message.reaction)
                        this.db.createReaction({
                            discordMessageId: getMessageId(discordMessage),
                            reaction: message.reaction,
                        })
                    } else {
                        const botId = this.client.user?.id
                        if (botId != null) {
                            await discordMessage.reactions
                                .resolve(message.reaction)
                                ?.users.remove(botId)
                        }
                        this.db.deleteReaction({
                            discordMessageId: getMessageId(discordMessage),
                            reaction: message.reaction,
                        })
                    }
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

const BOT = new Bot(CONFIG, chat.Chat.default(WEBSOCKET_PORT))
void BOT.start()
