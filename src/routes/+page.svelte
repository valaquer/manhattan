<script lang="ts">
	let { data } = $props();

	// Sidebar items — populate with your app's sections/folders
	const sidebarItems: string[] = [];
	const sidebarLabels: Record<string, string> = {};
	let activeItem = $state<string | null>(null);

	function selectItem(item: string) {
		activeItem = activeItem === item ? null : item;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
			e.preventDefault();
			const idx = sidebarItems.indexOf(activeItem ?? '');
			if (e.key === 'ArrowUp' && idx > 0) activeItem = sidebarItems[idx - 1];
			else if (e.key === 'ArrowDown' && idx < sidebarItems.length - 1) activeItem = sidebarItems[idx + 1];
			else if (e.key === 'ArrowDown' && idx === -1 && sidebarItems.length > 0) activeItem = sidebarItems[0];
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div style="display: flex; height: 100vh;">
	<!-- Sidebar -->
	<div class="hb-sidebar">
		<div class="hb-sidebar-scroll">
			<div class="hb-sidebar-header">
				<h2 class="hb-sidebar-header-text">Manhattan</h2>
			</div>
			{#each sidebarItems as item, i}
				<button
					class="hb-sidebar-item"
					class:active={activeItem === item}
					onclick={() => selectItem(item)}
					style="background: {activeItem === item ? 'var(--color-bg-element)' : (i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent')};"
				>
					<span class="hb-sidebar-item-label">{sidebarLabels[item] ?? item}</span>
				</button>
			{/each}
		</div>
		<div class="hb-sidebar-footer">
			Cache: ___
		</div>
	</div>

	<!-- Main content -->
	<div style="flex: 1; overflow-y: auto; padding: 2rem; font-size: 16px;">
		<p style="color: var(--color-text-muted);">Manhattan is ready. Start building.</p>
	</div>
</div>
