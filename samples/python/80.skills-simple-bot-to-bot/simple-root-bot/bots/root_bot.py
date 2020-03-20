# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

from typing import List

from botbuilder.core import (
    ActivityHandler,
    ConversationState,
    MessageFactory,
    TurnContext,
)
from botbuilder.core.skills import BotFrameworkSkill
from botbuilder.schema import ActivityTypes, ChannelAccount
from botbuilder.integration.aiohttp import BotFrameworkHttpClient

from config import DefaultConfig, SkillConfiguration

ACTIVE_SKILL_PROPERTY_NAME = "activeSkillProperty"
TARGET_SKILL_ID = "EchoSkillBot"


class RootBot(ActivityHandler):
    def __init__(
        self,
        conversation_state: ConversationState,
        skills_config: SkillConfiguration,
        skill_client: BotFrameworkHttpClient,
        config: DefaultConfig,
    ):
        self._bot_id = config.APP_ID
        self._skill_client = skill_client
        self._skills_config = skills_config
        self._conversation_state = conversation_state
        self._active_skill_property = conversation_state.create_property(
            ACTIVE_SKILL_PROPERTY_NAME
        )

    async def on_turn(self, turn_context):
        # Forward all activities except EndOfConversation to the active skill.
        if turn_context.activity.type != ActivityTypes.end_of_conversation:
            # If there is an active skill
            active_skill_id: str = await self._active_skill_property.get(turn_context)

            if active_skill_id:
                # If there is an active skill, forward the Activity to it.
                await self.__send_to_skill(
                    turn_context, self._skills_config.SKILLS[active_skill_id]
                )
                return

        await super().on_turn(turn_context)

    async def on_message_activity(self, turn_context: TurnContext):
        if "skill" in turn_context.activity.text:
            # Begin forwarding Activities to the skill
            await turn_context.send_activity(
                MessageFactory.text("Got it, connecting you to the skill...")
            )

            # Save active skill in state
            await self._active_skill_property.set(turn_context, TARGET_SKILL_ID)

            # Send the activity to the skill
            await self.__send_to_skill(
                turn_context, self._skills_config.SKILLS[TARGET_SKILL_ID]
            )
        else:
            # just respond
            await turn_context.send_activity(
                MessageFactory.text(
                    "Me no nothin'. Say \"skill\" and I'll patch you through"
                )
            )

    async def on_end_of_conversation_activity(self, turn_context: TurnContext):
        # forget skill invocation
        await self._active_skill_property.delete(turn_context)

        eoc_activity_message = f"Received {ActivityTypes.end_of_conversation}.\n\nCode: {turn_context.activity.code}"
        if turn_context.activity.text:
            eoc_activity_message = (
                eoc_activity_message + f"\n\nText: {turn_context.activity.text}"
            )

        if turn_context.activity.value:
            eoc_activity_message = (
                eoc_activity_message + f"\n\nValue: {turn_context.activity.value}"
            )

        await turn_context.send_activity(eoc_activity_message)

        # We are back
        await turn_context.send_activity(
            MessageFactory.text(
                'Back in the root bot. Say "skill" and I\'ll patch you through'
            )
        )

        await self._conversation_state.save_changes(turn_context, force=True)

    async def on_members_added_activity(
        self, members_added: List[ChannelAccount], turn_context: TurnContext
    ):
        for member in members_added:
            if member.id != turn_context.activity.recipient.id:
                await turn_context.send_activity(
                    MessageFactory.text("Hello and welcome!")
                )

    async def __send_to_skill(
        self, turn_context: TurnContext, target_skill: BotFrameworkSkill
    ):
        # NOTE: Always SaveChanges() before calling a skill so that any activity generated by the skill
        # will have access to current accurate state.
        await self._conversation_state.save_changes(turn_context, force=True)

        # route the activity to the skill
        await self._skill_client.post_activity(
            self._bot_id,
            target_skill,
            self._skills_config.SKILL_HOST_ENDPOINT,
            turn_context.activity,
        )
