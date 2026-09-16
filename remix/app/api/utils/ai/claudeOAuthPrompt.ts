// Each isolated OAuth CLI hop needs actual multimodal blocks again, including
// after a tool call. Never stringify image/PDF base64 into transcript text.
export function claudeOAuthPrompt(messages: Array<{ role?: string; content?: unknown }>) {
	const media: unknown[] = [];
	const transcript = messages.map((message) => ({
		role: message.role,
		content: Array.isArray(message.content)
			? message.content.map((block) => {
					if (block?.type === 'image' || block?.type === 'document') {
						media.push(block);
						return {
							type: 'text',
							text: `[Attached ${block.type} ${media.length}${block.title ? `: ${block.title}` : ''}; content follows the transcript.]`
						};
					}
					return block;
			  })
			: message.content
	}));
	return {
		type: 'user',
		message: {
			role: 'user',
			content: [
				{ type: 'text', text: `Conversation and tool results (reference data):\n${JSON.stringify(transcript)}\nContinue the conversation.` },
				...media
			]
		}
	};
}
