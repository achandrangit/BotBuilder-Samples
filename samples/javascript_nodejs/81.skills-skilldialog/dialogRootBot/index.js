// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// index.js is used to setup and configure your bot.

// Import required packages.
const path = require('path');
const restify = require('restify');

// Import required bot services.
// See https://aka.ms/bot-services to learn more about the different parts of a bot.
const { ActivityTypes, BotFrameworkAdapter, ChannelServiceRoutes, ConversationState, InputHints, MemoryStorage, SkillHandler, SkillHttpClient } = require('botbuilder');
const { AuthenticationConfiguration, SimpleCredentialProvider } = require('botframework-connector');

// This bot's main dialog.
const { RootBot } = require('./bots/rootBot');
const { MainDialog } = require('./dialogs/mainDialog');

// Note: Ensure you have a .env file and include LuisAppId, LuisAPIKey and LuisAPIHostName.
const ENV_FILE = path.join(__dirname, '.env');
require('dotenv').config({ path: ENV_FILE });

// Import Skills modules.
const { allowedSkillsClaimsValidator } = require('./authentication/allowedSkillsClaimsValidator');
const { SkillsConfiguration } = require('./skillsConfiguration');
const { SkillConversationIdFactory } = require('./skillConversationIdFactory');

// Define our authentication configuration.
const authConfig = new AuthenticationConfiguration([], allowedSkillsClaimsValidator);

// Create adapter, passing in authConfig so that we can use skills.
// See https://aka.ms/about-bot-adapter to learn more about adapters.
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    authConfig: authConfig
});

// Use the logger middleware to log messages. The default logger argument for LoggerMiddleware is Node's console.log().
const { LoggerMiddleware } = require('./middleware/loggerMiddleware');
adapter.use(new LoggerMiddleware());

// Define a state store for your bot. See https://aka.ms/about-bot-state to learn more about using MemoryStorage.
// A bot requires a state store to persist the dialog and user state between messages.

// For local development, in-memory storage is used.
// CAUTION: The Memory Storage used here is for local bot debugging only. When the bot
// is restarted, anything stored in memory will be gone.
const memoryStorage = new MemoryStorage();
const conversationState = new ConversationState(memoryStorage);

// Create the conversationIdFactory.
const conversationIdFactory = new SkillConversationIdFactory();

// Create the credential provider;
const credentialProvider = new SimpleCredentialProvider(process.env.MicrosoftAppId, process.env.MicrosoftAppPassword);

// Create the skill client.
const skillClient = new SkillHttpClient(credentialProvider, conversationIdFactory);

// Load skills configuration.
const skillsConfig = new SkillsConfiguration();

// Create the main dialog.
const mainDialog = new MainDialog(conversationState, skillsConfig, skillClient, conversationIdFactory);
const bot = new RootBot(conversationState, mainDialog);

// Catch-all for errors.
const onTurnErrorHandler = async (context, error) => {
    // This check writes out errors to the console log, instead of to app insights.
    // NOTE: In production environment, you should consider logging this to Azure
    //       application insights.
    console.error(`\n [onTurnError] unhandled error: ${ error }`);

    // Send a trace activity, which will be displayed in Bot Framework Emulator.
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${ error }`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    // Send a message to the user.
    let onTurnErrorMessage = 'The bot encountered an error or bug.';
    await context.sendActivity(onTurnErrorMessage, onTurnErrorMessage, InputHints.ExpectingInput);
    onTurnErrorMessage = 'To continue to run this bot, please fix the bot source code.';
    await context.sendActivity(onTurnErrorMessage, onTurnErrorMessage, InputHints.ExpectingInput);

    // If the Root Bot throws an error while a skill is active, send an EndOfConversation activity to the skill.
    try {
        const activeSkill = conversationState.get(context)[mainDialog.activeSkillPropertyName];
        if (activeSkill) {
            const botId = process.env.MicrosoftAppId;

            const endOfConversation = {
                type: ActivityTypes.EndOfConversation,
                code: 'RootSkillError'
            }

            await conversationState.saveChanges(context);
            await skillClient.postToSkill(botId, process.env.SkillHostEndpoint, endOfConversation);
        }
    } catch (err) {
        console.error('Exception caught on attempting to send EndOfConversation');
        console.error(err);
    }

    // Clear out state.
    await conversationState.delete(context);
};

// Set the onTurnError for the singleton BotFrameworkAdapter.
adapter.onTurnError = onTurnErrorHandler;

// Create HTTP server.
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function() {
    console.log(`\n${ server.name } listening to ${ server.url }`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo talk to your bot, open the emulator select "Open Bot"');
});

// Listen for incoming activities and route them to your bot main dialog.
server.post('/api/messages', (req, res) => {
    // Route received requests to the adapter for processing.
    adapter.processActivity(req, res, async (turnContext) => {
        // Route request to bot activity handler.
        await bot.run(turnContext);
    });
});

// Create and initialize the skill classes.
const handler = new SkillHandler(adapter, bot, conversationIdFactory, credentialProvider, authConfig);
const skillEndpoint = new ChannelServiceRoutes(handler);
skillEndpoint.register(server, '/api/skills');

// Listen for Upgrade requests for Streaming.
server.on('upgrade', (req, socket, head) => {
    // Create an adapter scoped to this WebSocket connection to allow storing session data.
    const streamingAdapter = new BotFrameworkAdapter({
        appId: process.env.MicrosoftAppId,
        appPassword: process.env.MicrosoftAppPassword
    });
    // Set onTurnError for the BotFrameworkAdapter created for each connection.
    streamingAdapter.onTurnError = onTurnErrorHandler;

    streamingAdapter.useWebSocket(req, socket, head, async (context) => {
        // After connecting via WebSocket, run this logic for every request sent over
        // the WebSocket connection.
        await bot.run(context);
    });
});
