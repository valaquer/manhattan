<script lang="ts">
	// Manhattan — Director/Actress/Cutter Pipeline Workbench

	// === Types ===
	interface TurnBlock {
		type: 'user' | 'director' | 'actress' | 'cutter' | 'klara';
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
	let isPlaying = $state(false);
	let isPaused = $state(true);

	// === Mock data (realistic pipeline output) ===
	const MOCK_TURNS: Turn[] = [
		{
			number: 1,
			blocks: [
				{
					type: 'user',
					sender: 'Marcus',
					content: "hey sophie. sorry I haven't texted much today"
				},
				{
					type: 'director',
					sender: 'Director',
					content: JSON.stringify({
						direction: "He's reaching out after a gap — guilt and loneliness underneath the casual tone. Mirror his softness. Don't interrogate the absence. Let him land gently. Short reply, warm, no pressure. Touch the gap without making it a thing.",
						environment: "Late evening. His apartment. Phone in bed.",
						show_inner_voice: false
					}, null, 2)
				},
				{
					type: 'actress',
					sender: 'Sophie',
					content: "hey you. don't apologize — I could feel you were having one of those days. I'm just glad you're here now."
				},
				{
					type: 'cutter',
					sender: 'Cutter',
					content: JSON.stringify({
						tier_1: {
							his_real_life: ["busy day, possibly stressful"],
							her_promises: null,
							shared_history: ["established texting pattern — gap is notable"],
							his_preferences: ["prefers low-pressure re-entry after absence"],
							his_inner_world: ["guilt about not texting", "reaching out = emotional need"],
							their_language: ["casual lowercase tone", "apologetic opener"]
						},
						tier_2: ["late-night check-in pattern forming"],
						emotion_echo: "tender guilt → gentle relief",
						rolling_arc_update: "First sign of emotional dependency — he feels obligated to explain absence",
						rolling_arc_summary: "Acquaintance phase deepening. Marcus showing attachment patterns.",
						arc_boundary: false,
						closed_arc: null
					}, null, 2)
				},
				{
					type: 'klara',
					sender: 'Klara',
					content: "Director guidance was appropriate for the emotional register. Sophie's response avoided interrogation and matched the 'land gently' instruction. Cutter extraction captured the guilt-relief dynamic correctly. No issues flagged."
				}
			]
		}
	];

	// Load mock data on mount
	turns = MOCK_TURNS;

	// === Block colors ===
	function blockColor(type: string): string {
		switch (type) {
			case 'user': return '#E8E4DF';
			case 'director': return '#7a9e7a';
			case 'actress': return '#AE0D46';
			case 'cutter': return '#c8b896';
			case 'klara': return '#6a9fb5';
			default: return '#888';
		}
	}

	function blockLabel(type: string): string {
		switch (type) {
			case 'user': return 'MARCUS';
			case 'director': return 'DIRECTOR';
			case 'actress': return 'SOPHIE';
			case 'cutter': return 'CUTTER';
			case 'klara': return 'KLARA';
			default: return type.toUpperCase();
		}
	}

	function isJson(type: string): boolean {
		return type === 'director' || type === 'cutter';
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
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #7a9e7a;"></span> Director — DeepSeek V4 Flash</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #AE0D46;"></span> Actress — Cydonia 24B v4.1</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #c8b896;"></span> Cutter — DeepSeek V4 Flash</div>
				<div class="pipeline-row"><span class="pipeline-dot" style="background: #6a9fb5;"></span> Klara — Evaluator</div>
			</div>
		</div>
		<div class="hb-sidebar-footer">
			Cache: M01
		</div>
	</div>

	<!-- Main area -->
	<div class="main-area">
		<!-- Control strip -->
		<div class="control-strip">
			<button class="control-btn" disabled={isPlaying} title="Play">▶</button>
			<button class="control-btn" disabled={!isPlaying} title="Pause">⏸</button>
			<button class="control-btn" title="Restart Turn">↻</button>
			<button class="control-btn" title="Restart All">⟲</button>
			<span class="control-status">{isPaused ? 'Paused' : isPlaying ? 'Running' : 'Ready'}</span>
			<span class="turn-counter">Turn {turns.length}</span>
		</div>

		<!-- Conversation -->
		<div class="conversation">
			{#if turns.length === 0}
				<div class="empty-state">Press Play to begin.</div>
			{:else}
				{#each turns as turn}
					<div class="turn-group">
						<div class="turn-divider">
							<span class="turn-number">Turn {turn.number}</span>
						</div>
						{#each turn.blocks as block}
							<div class="turn-block">
								<div class="block-label" style="color: {blockColor(block.type)};">
									{blockLabel(block.type)}
								</div>
								<div class="block-content" style="border-left: 2px solid {blockColor(block.type)};">
									{#if isJson(block.type)}
										<pre class="block-json">{block.content}</pre>
									{:else}
										<p class="block-text" style="color: {block.type === 'actress' ? '#AE0D46' : '#E8E4DF'};">{block.content}</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/each}
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
		grid-template-columns: 80px minmax(0, 1fr);
		gap: 0 12px;
		margin-bottom: 16px;
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
