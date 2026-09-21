export const collectionStyles = `
.tt-collection {
	scroll-margin-top: 90px;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 12px;
}
.tt-collection-controls {
	display: flex;
	align-items: end;
	flex-wrap: wrap;
	gap: 10px;
}
.tt-collection-search {
	flex: 1 1 180px;
	min-width: 0;
}
.tt-collection-field {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 11px;
	color: var(--sw-muted, var(--tt-muted));
	min-width: 0;
	max-width: 100%;
}
.tt-collection input,
.tt-collection select {
	min-height: 36px;
	border: 1px solid var(--sw-line, var(--tt-border));
	border-radius: 8px;
	padding: 7px 9px;
	background: var(--sw-bg, var(--tt-bg));
	color: inherit;
	min-width: 0;
	max-width: 100%;
	font: inherit;
	font-size: 12px;
}
.tt-collection-search input {
	width: 100%;
	background: transparent;
}
.tt-collection-count,
.tt-collection-empty,
.tt-collection-more {
	font-size: 12px;
	color: var(--sw-muted, var(--tt-muted));
}
.tt-collection-pagination {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	font-size: 12px;
}
.tt-collection-pagination label {
	display: flex;
	align-items: center;
	gap: 5px;
}
.tt-collection button {
	min-height: 36px;
	border: 1px solid var(--sw-line, var(--tt-border));
	border-radius: 8px;
	padding: 7px 10px;
	font-size: 12px;
}
.tt-collection button:disabled {
	opacity: 0.45;
	cursor: default;
}
.tt-collection-sr {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
}
.tt-collection-more {
	min-height: 24px;
}
.sw-day .tt-collection-controls:empty {
	display: none;
}
.sw-day .tt-collection-pagination {
	justify-content: center;
}
.sw-day .tt-collection-pagination label {
	order: -1;
	width: 100%;
	justify-content: center;
}
.sw-day .tt-collection-pagination button {
	padding-inline: 6px;
	font-size: 10px;
}
@media (max-width: 480px) {
	.tt-collection-search {
		flex-basis: 100%;
	}
	.tt-collection-field {
		flex: 1 1 95px;
	}
}
`;
