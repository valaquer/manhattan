<script lang="ts">
	// Manhattan --Director/Actress/Cutter Pipeline Workbench
	import { Rewind, FastForward, Play, Pause, RotateCcw, RotateCw } from 'lucide-svelte';
	import { onMount } from 'svelte';

	// === Types ===
	interface TurnBlock {
		type: string;
		sender: string;
		content: string;
		meta?: Record<string, unknown>;
		promptTokens?: number | null;
		completionTokens?: number | null;
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
	let showRetryInput = $state(false);
	let retryFeedback = $state('');
	let sessions = $state<Array<{ id: number; created_at: string; turnCount: number }>>([]);
	let activeSessionId = $state<number | null>(null);
	let latestSessionId = $state<number | null>(null);
	let isViewingOldSession = $derived(activeSessionId !== null && latestSessionId !== null && activeSessionId !== latestSessionId);
	let sessionTotalTokens = $derived(turns.reduce((total, t) => total + t.blocks.reduce((sum, b) => sum + (b.promptTokens ?? 0) + (b.completionTokens ?? 0), 0), 0));

	// === Model settings ===
	let directorModel = $state('deepseek/deepseek-v4-flash-0731');
	let actressModel = $state('nousresearch/hermes-4-70b');
	let reasoningEffort = $state('none');
	let showSettings = $state(false);

	// === Turn navigation ===
	function goForward() {
		if (currentTurnIndex < turns.length - 1) currentTurnIndex++;
	}

	function goBack() {
		if (currentTurnIndex > 0) currentTurnIndex--;
	}

	// === Load turns from DB ===
	async function loadTurns(sessionId?: number) {
		const url = sessionId ? `/api/turns?sessionId=${sessionId}` : '/api/turns';
		const res = await fetch(url);
		if (res.ok) {
			const data = await res.json();
			turns = data.turns;
			activeSessionId = data.sessionId;
			if (turns.length > 0) {
				currentTurnIndex = turns.length - 1;
			} else {
				currentTurnIndex = 0;
			}
		}
	}

	async function loadSessions() {
		const res = await fetch('/api/sessions');
		if (res.ok) {
			const data = await res.json();
			sessions = data.sessions;
			if (sessions.length > 0) latestSessionId = sessions[0].id;
		}
	}

	function switchSession(sessionId: number) {
		loadTurns(sessionId);
	}

	onMount(() => {
		loadTurns();
		loadSessions();
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

		const res = await fetch('/api/pipeline', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				models: {
					director: directorModel,
					actress: actressModel,
					reviewer: directorModel,
					cutter: directorModel,
					archivist: directorModel,
				},
				reasoningEffort,
			}),
		});

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
						// Streaming start --add empty Actress block
						const currentTurn = turns[currentTurnIndex];
						currentTurn.blocks = [...currentTurn.blocks, { type: 'actress-for-character', sender: 'Actress for Character', content: '' }];
						turns = [...turns];
						streamingContent = '';
					} else if (event.type === 'actress-for-character' && !event.streaming) {
						// Streaming complete --finalize Sophie block
						streamingContent = '';
					} else if (event.type === 'error') {
						const currentTurn = turns[currentTurnIndex];
						currentTurn.blocks = [...currentTurn.blocks, { type: 'error', sender: 'Error', content: event.content }];
						turns = [...turns];
					} else if (event.type === 'stage') {
						const currentTurn = turns[currentTurnIndex];
						currentTurn.blocks = [...currentTurn.blocks, { type: event.stage, sender: event.stage, content: event.content }];
						turns = [...turns];
					} else if (event.type === 'warning') {
						const currentTurn = turns[currentTurnIndex];
						currentTurn.blocks = [...currentTurn.blocks, { type: 'warning', sender: `Warning: ${event.stage}`, content: event.error || '' }];
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
		const res = await fetch('/api/reset', { method: 'POST' });
		if (res.ok) {
			const data = await res.json();
			console.log('New session:', data.sessionId);
		}
		turns = [];
		currentTurnIndex = 0;
	}

	// === Retry ===
	function toggleRetryInput() {
		showRetryInput = !showRetryInput;
		if (!showRetryInput) retryFeedback = '';
	}

	async function submitRetry() {
		if (!retryFeedback.trim() || turns.length === 0) return;
		const currentTurn = turns[currentTurnIndex];
		const actressBlock = currentTurn.blocks.find(b =>
			b.type === 'actress-for-character' || b.type === 'actress'
		);
		const rejectedTake = actressBlock?.content ?? '';

		showRetryInput = false;
		isPlaying = true;
		isPaused = false;

		currentTurn.blocks = currentTurn.blocks.filter(b =>
			b.type === 'director-for-user' || b.type === 'actor-for-user' || b.type === 'user'
		);
		turns = [...turns];

		const res = await fetch('/api/pipeline', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				retry: { rejectedTake, feedback: retryFeedback, turnNumber: currentTurn.number },
			}),
		});

		if (!res.ok || !res.body) {
			isPlaying = false;
			isPaused = true;
			retryFeedback = '';
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
					if (event.type === 'error') {
						currentTurn.blocks = [...currentTurn.blocks, { type: 'error', sender: 'Error', content: event.content }];
					} else if (event.type === 'stage') {
						currentTurn.blocks = [...currentTurn.blocks, { type: event.type === 'stage' ? event.stage : event.type, sender: event.sender || event.stage, content: event.content }];
					}
					turns = [...turns];
				} catch { /* skip */ }
			}
		}

		isPlaying = false;
		isPaused = true;
		retryFeedback = '';
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
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #888;"></span> Director for User --DeepSeek V4 Flash 0731</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #D4A574;"></span> Actor for User --Hermes 4 70B</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #888;"></span> Director for Character --DeepSeek V4 Flash 0731</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #AE0D46;"></span> Actress for Character --Hermes 4 70B</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #888;"></span> Artisan Cutter --DeepSeek V4 Flash 0731</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #b0aba5;"></span> Klara --Evaluator</div>
			</div>

			<!-- Model settings -->
			<div class="pipeline-info">
				<button class="pipeline-label settings-toggle" onclick={() => showSettings = !showSettings}>
					Settings {showSettings ? '▾' : '▸'}
				</button>
				{#if showSettings}
					<div class="settings-panel">
						<div class="setting-group">
							<div class="setting-group-label">Director · Reviewer · Cutter</div>
							<label class="setting-row">
								<span class="setting-label">Model</span>
								<input class="setting-input" bind:value={directorModel} />
							</label>
							<label class="setting-row">
								<span class="setting-label">Reasoning</span>
								<select class="setting-input" bind:value={reasoningEffort}>
									<option value="none">none</option>
									<option value="low">low</option>
									<option value="medium">medium</option>
									<option value="high">high</option>
								</select>
							</label>
						</div>
						<div class="setting-group">
							<div class="setting-group-label">Actress · Actor</div>
							<label class="setting-row">
								<span class="setting-label">Model</span>
								<input class="setting-input" bind:value={actressModel} />
							</label>
						</div>
					</div>
				{/if}
			</div>

			<!-- Session browser -->
			{#if sessions.length > 1}
				<div class="session-browser">
					<div class="pipeline-label">Sessions</div>
					{#each sessions as session}
						<button
							class="session-row"
							class:active={session.id === activeSessionId}
							onclick={() => switchSession(session.id)}
						>
							{new Date(session.created_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, {new Date(session.created_at + 'Z').toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} · {session.turnCount} turns
						</button>
					{/each}
				</div>
			{/if}
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
			<button class="control-btn" disabled={isPlaying || isViewingOldSession} onclick={runPipeline} title="Play"><Play size={14} /></button>
			<button class="control-btn" disabled={!isPlaying} title="Pause"><Pause size={14} /></button>
			<button class="control-btn" onclick={toggleRetryInput} disabled={turns.length === 0 || isPlaying || isViewingOldSession} title="Retry"><RotateCcw size={14} /></button>
			<button class="control-btn" onclick={resetAll} title="Restart All"><RotateCw size={14} /></button>
			<span class="control-status">{isPlaying ? 'Running' : isPaused ? 'Paused' : 'Ready'}</span>
			<span class="turn-counter">{turns.length > 0 ? `Turn ${currentTurnIndex + 1} / ${turns.length}` : 'No turns'}{sessionTotalTokens > 0 ? ` · ${sessionTotalTokens.toLocaleString()} tokens` : ''}</span>
		</div>

		<!-- Retry feedback bar -->
		{#if showRetryInput}
			<div class="retry-bar">
				<input
					class="retry-input"
					type="text"
					placeholder="What was wrong with Sophie's response?"
					bind:value={retryFeedback}
					onkeydown={(e) => { if (e.key === 'Enter') submitRetry(); }}
				/>
				<button class="retry-submit" onclick={submitRetry} disabled={!retryFeedback.trim()}>Retry</button>
			</div>
		{/if}

		<!-- Conversation (one turn at a time) -->
		<div class="conversation">
			{#if turns.length === 0}
				<div class="empty-state">Press Play to begin.</div>
			{:else}
				{@const turn = turns[currentTurnIndex]}
				{@const turnTokens = turn.blocks.reduce((sum, b) => sum + (b.promptTokens ?? 0) + (b.completionTokens ?? 0), 0)}
				<div class="turn-group">
					<div class="turn-divider">
						<span class="turn-number">Turn {turn.number}</span>
						{#if turnTokens > 0}
							<span class="turn-cost">{turnTokens.toLocaleString()} tokens</span>
						{/if}
					</div>
					{#each turn.blocks as block}
						<div class="turn-block" class:klara-block={block.type === 'klara'}>
							<div class="block-label" style="color: {blockColor(block.type)};">
								{blockLabel(block.type)}
								{#if block.promptTokens || block.completionTokens}
									<div class="block-tokens">{block.promptTokens ?? 0}→{block.completionTokens ?? 0}</div>
								{/if}
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

	/* --- Retry bar --- */
	.retry-bar {
		display: flex;
		gap: 8px;
		padding: 8px 24px;
		background: rgba(174, 13, 70, 0.08);
		border-bottom: 1px dashed #AE0D46;
	}

	.retry-input {
		flex: 1;
		background: transparent;
		border: 1px solid #333;
		border-radius: 4px;
		color: #E8E4DF;
		padding: 6px 12px;
		font-family: inherit;
		font-size: 12px;
	}

	.retry-input::placeholder { color: #555; }

	.retry-submit {
		background: #AE0D46;
		border: none;
		border-radius: 4px;
		color: #E8E4DF;
		padding: 6px 16px;
		font-family: inherit;
		font-size: 12px;
		cursor: pointer;
	}

	.retry-submit:disabled { opacity: 0.3; cursor: default; }

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
		display: flex;
		align-items: center;
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

	/* --- Cost display --- */
	.turn-cost {
		color: #555;
		font-size: 10px;
		margin-left: auto;
	}

	.block-tokens {
		font-size: 9px;
		color: #444;
		font-weight: normal;
		margin-top: 2px;
	}

	/* --- Settings panel --- */
	.settings-toggle {
		background: none;
		border: none;
		cursor: pointer;
		font-family: inherit;
		padding: 0;
	}

	.settings-panel {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
	}

	.setting-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.setting-group {
		margin-bottom: 10px;
	}

	.setting-group-label {
		color: #666;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		margin-bottom: 4px;
	}

	.setting-label {
		color: #555;
		font-size: 10px;
		min-width: 60px;
	}

	.setting-input {
		flex: 1;
		background: transparent;
		border: none;
		color: #E8E4DF;
		font-size: 10px;
		padding: 3px 0;
		font-family: inherit;
	}

	.setting-input:focus {
		outline: none;
		border-bottom: 1px solid #444;
	}

	/* --- Session browser --- */
	.session-browser {
		padding: 12px 16px;
		margin: 8px;
	}

	.session-row {
		display: block;
		width: 100%;
		background: none;
		border: none;
		color: #555;
		font-size: 10px;
		line-height: 2;
		text-align: left;
		cursor: pointer;
		padding: 2px 8px;
		border-radius: 3px;
		font-family: inherit;
	}

	.session-row:hover { color: #888; background: rgba(255,255,255,0.03); }
	.session-row.active { color: #E8E4DF; background: rgba(255,255,255,0.06); }

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
