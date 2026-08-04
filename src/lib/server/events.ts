const target = new EventTarget();

export function emitReview(sessionId: number, turnNumber: number, stage: string) {
	target.dispatchEvent(new CustomEvent('klara-review', { detail: { sessionId, turnNumber, stage } }));
}

export function onReview(handler: (e: CustomEvent) => void): () => void {
	target.addEventListener('klara-review', handler as EventListener);
	return () => target.removeEventListener('klara-review', handler as EventListener);
}
