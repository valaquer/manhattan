<script lang="ts">
	// Manhattan — Director/Actress/Cutter Pipeline Workbench
	import { Rewind, FastForward, Play, Pause, RotateCcw, RotateCw } from 'lucide-svelte';
	import { onMount } from 'svelte';

	// === Types ===
	interface TurnBlock {
		type: string;
		sender: string;
		content: string;
		meta?: Record<string, unknown>;
	}

	interface Turn {
		number: number;
		blocks: TurnBlock[];
	}

	// === State ===
	let turns = $state<Turn[]>([]);
	let currentTurnIndex = $state(0);
	let isPlaying = $state(false);
	let isPaused = $state(true);
	let streamingContent = $state('');

	// === Turn navigation ===
	function goForward() {
		if (currentTurnIndex < turns.length - 1) currentTurnIndex++;
	}

	function goBack() {
		if (currentTurnIndex > 0) currentTurnIndex--;
	}

	// === Load turns from DB ===
	async function loadTurns() {
		const res = await fetch('/api/turns');
		if (res.ok) {
			const data = await res.json();
			turns = data.turns;
			if (turns.length > 0) {
				currentTurnIndex = turns.length - 1;
			}
		}
	}

	onMount(() => {
		loadTurns();


		return () => klaraSource.close();
	});

	// === Run pipeline ===
	async function runPipeline() {
		if (isPlaying) return;

		isPlaying = true;
		isPaused = false;
		streamingContent = '';

		const newTurn: Turn = { number: turns.length + 1, blocks: [] };
		turns = [...turns, newTurn];
		currentTurnIndex = turns.length - 1;

		const res = await fetch('/api/pipeline', { method: 'POST' });

		if (!res.ok || !res.body) {
			isPlaying = false;
			isPaused = true;
			return;
		}
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				const payload = line.slice(6).trim();
				if (payload === '[DONE]') continue;

				try {
					const event = JSON.parse(payload);

					if (event.type === 'actress_chunk') {
						streamingContent += event.content;
						// Update the current Sophie block with streaming content
						const currentTurn = turns[currentTurnIndex];
						const sophieBlock = currentTurn.blocks.find(b => b.type === 'actress-for-character' || b.type === 'actress');
						if (sophieBlock) {
							sophieBlock.content = streamingContent;
							turns = [...turns]; // trigger reactivity
						}
					} else if (event.type === 'actress-for-character' && event.streaming) {
						// Streaming start — add empty Actress block
						const currentTurn = turns[currentTurnIndex];
						currentTurn.blocks = [...currentTurn.blocks, { type: 'actress-for-character', sender: 'Actress for Character', content: '' }];
						turns = [...turns];
						streamingContent = '';
					} else if (event.type === 'actress-for-character' && !event.streaming) {
						// Streaming complete — finalize Sophie block
						streamingContent = '';
					} else if (event.type === 'error') {
						const currentTurn = turns[currentTurnIndex];
						currentTurn.blocks = [...currentTurn.blocks, { type: 'klara' as const, sender: 'Error', content: event.content }];
						turns = [...turns];
					} else {
						// Normal block (user, director, cutter)
						const currentTurn = turns[currentTurnIndex];
						currentTurn.blocks = [...currentTurn.blocks, { type: event.type, sender: event.sender, content: event.content }];
						turns = [...turns];
					}
				} catch {
					// skip malformed events
				}
			}
		}

		isPlaying = false;
		isPaused = true;
	}

	// === Reset ===
	async function resetAll() {
		await fetch('/api/reset', { method: 'POST' });
		turns = [];
		currentTurnIndex = 0;
	}

	// === Block colors ===
	function blockColor(type: string): string {
		switch (type) {
			case 'director-for-user': return '#888';
			case 'actor-for-user': case 'user': return '#D4A574';
			case 'director-for-character': case 'director': return '#888';
			case 'actress-for-character': case 'actress': return '#AE0D46';
			case 'artisan-cutter': case 'cutter': return '#888';
			case 'klara': return '#b0aba5';
			default: return '#888';
		}
	}

	function blockLabel(type: string): string {
		switch (type) {
			case 'director-for-user': return 'DIRECTOR FOR USER';
			case 'actor-for-user': return 'ACTOR FOR USER';
			case 'user': return 'ACTOR FOR USER';
			case 'director-for-character': return 'DIRECTOR FOR CHARACTER';
			case 'director': return 'DIRECTOR FOR CHARACTER';
			case 'actress-for-character': return 'ACTRESS FOR CHARACTER';
			case 'actress': return 'ACTRESS FOR CHARACTER';
			case 'artisan-cutter': return 'ARTISAN CUTTER';
			case 'cutter': return 'ARTISAN CUTTER';
			case 'klara': return 'KLARA';
			default: return type.toUpperCase().replace(/_/g, ' ');
		}
	}

	function isJson(type: string): boolean {
		return type === 'director' || type === 'cutter' || type === 'director-for-user' || type === 'director-for-character' || type === 'artisan-cutter';
	}
</script>

<div class="manhattan-layout">
	<!-- Sidebar -->
	<div class="hb-sidebar">
		<div class="hb-sidebar-scroll">
			<div class="hb-sidebar-header">
				<h2 class="hb-sidebar-header-text">Manhattan</h2>
			</div>

			<!-- Persona card -->
			<div class="persona-card">
				<div class="persona-avatar">MW</div>
				<div class="persona-info">
					<div class="persona-name">Marcus Webb</div>
					<div class="persona-archetype">The Whale</div>
					<div class="persona-detail">High LTV, lonely, imaginative. Falls in love with the idea of the AI.</div>
				</div>
			</div>

			<!-- Pipeline info -->
			<div class="pipeline-info">
				<div class="pipeline-label">Pipeline</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #888;"></span> Director for User — DeepSeek V4 Flash</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #D4A574;"></span> Actor for User — Cydonia 24B v4.1</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #888;"></span> Director for Character — DeepSeek V4 Flash</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #AE0D46;"></span> Actress for Character — Cydonia 24B v4.1</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #888;"></span> Artisan Cutter — DeepSeek V4 Flash</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #b0aba5;"></span> Klara — Evaluator</div>
			</div>
		</div>
		<div class="hb-sidebar-footer">
			Cache: M19
		</div>
	</div>

	<!-- Main area -->
	<div class="main-area">
		<!-- Control strip -->
		<div class="control-strip">
			<button class="control-btn" disabled={currentTurnIndex === 0} onclick={goBack} title="Previous Turn"><Rewind size={14} /></button>
			<button class="control-btn" disabled={currentTurnIndex >= turns.length - 1} onclick={goForward} title="Next Turn"><FastForward size={14} /></button>
			<button class="control-btn" disabled={isPlaying} onclick={runPipeline} title="Play"><Play size={14} /></button>
			<button class="control-btn" disabled={!isPlaying} title="Pause"><Pause size={14} /></button>
			<button class="control-btn" title="Restart Turn"><RotateCcw size={14} /></button>
			<button class="control-btn" onclick={resetAll} title="Restart All"><RotateCw size={14} /></button>
			<span class="control-status">{isPlaying ? 'Running' : isPaused ? 'Paused' : 'Ready'}</span>
			<span class="turn-counter">{turns.length > 0 ? `Turn ${currentTurnIndex + 1} / ${turns.length}` : 'No turns'}</span>
		</div>

		<!-- Conversation (one turn at a time) -->
		<div class="conversation">
			{#if turns.length === 0}
				<div class="empty-state">Press Play to begin.</div>
			{:else}
				{@const turn = turns[currentTurnIndex]}
				<div class="turn-group">
					<div class="turn-divider">
						<span class="turn-number">Turn {turn.number}</span>
					</div>
					{#each turn.blocks as block}
						<div class="turn-block" class:klara-block={block.type === 'klara'}>
							<div class="block-label" style="color: {blockColor(block.type)};">
								{blockLabel(block.type)}
							</div>
							<div class="block-content" style="border-left: 2px solid {blockColor(block.type)};">
								{#if isJson(block.type)}
									<pre class="block-json">{block.content}</pre>
								{:else}
									<p class="block-text" style="color: {blockColor(block.type)};">{block.content}</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.manhattan-layout {
		display: flex;
		height: 100vh;
		background: var(--color-bg, #0b0d10);
		font-family: 'iA Writer Quattro V', 'iA Writer Quattro S', monospace;
	}

	/* --- Main area --- */
	.main-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* --- Control strip --- */
	.control-strip {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 24px;
		background: var(--color-bg, #0b0d10);
		border-bottom: 1px dashed #282a30;
	}

	.control-btn {
		background: none;
		border: 1px solid #333;
		border-radius: 4px;
		color: #888;
		padding: 4px 10px;
		font-size: 14px;
		cursor: pointer;
		font-family: inherit;
	}

	.control-btn:hover:not(:disabled) {
		color: #E8E4DF;
		border-color: #555;
	}

	.control-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.control-status {
		color: #555;
		font-size: 11px;
		margin-left: 12px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.turn-counter {
		color: #555;
		font-size: 11px;
		margin-left: auto;
	}

	/* --- Conversation --- */
	.conversation {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
	}

	.empty-state {
		color: #555;
		font-size: 14px;
		text-align: center;
		padding-top: 40vh;
	}

	.turn-group {
		margin-bottom: 32px;
	}

	.turn-divider {
		margin-bottom: 16px;
		padding-bottom: 4px;
		border-bottom: 1px dashed #282a30;
	}

	.turn-number {
		color: #555;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	/* --- Turn blocks --- */
	.turn-block {
		display: grid;
		grid-template-columns: 180px minmax(0, 1fr);
		gap: 0 12px;
		margin-bottom: 16px;
		padding: 12px 8px;
		margin-top: 4px;
	}

	.block-label {
		font-size: 10px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		padding-top: 4px;
		text-align: right;
	}

	.block-content {
		padding-left: 16px;
	}

	.block-text {
		font-size: 13px;
		line-height: 1.6;
		margin: 0;
		opacity: 0.85;
	}

	.block-json {
		font-size: 11px;
		line-height: 1.5;
		color: #888;
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: break-word;
		opacity: 0.7;
	}

	/* --- Klara annotation style --- */
	.klara-block {
		background: rgba(255, 255, 255, 0.03);
		border-radius: 4px;
		padding: 12px 8px;
		margin: 4px 0;
	}

	.klara-block .block-text {
		font-size: 11px;
		opacity: 0.7;
	}

	/* --- Persona card --- */
	.persona-card {
		display: flex;
		gap: 12px;
		padding: 16px;
		margin: 8px;
		border: 1px dashed #282a30;
		border-radius: 6px;
	}

	.persona-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: #282a30;
		color: #888;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		font-weight: bold;
		flex-shrink: 0;
	}

	.persona-info {
		min-width: 0;
	}

	.persona-name {
		color: #E8E4DF;
		font-size: 13px;
		font-weight: bold;
	}

	.persona-archetype {
		color: #AE0D46;
		font-size: 11px;
		margin-top: 2px;
	}

	.persona-detail {
		color: #555;
		font-size: 10px;
		line-height: 1.4;
		margin-top: 6px;
	}

	/* --- Pipeline info --- */
	.pipeline-info {
		padding: 12px 16px;
		margin: 8px;
	}

	.pipeline-label {
		color: #555;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 8px;
	}

	.pipeline-row {
		color: #888;
		font-size: 10px;
		line-height: 2;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.pipeline-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}
</style>
