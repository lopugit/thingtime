import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { registerKindRenderer } from './kindRegistry';
import type { KindRenderContext } from './kindRegistry';
import {
	BodyText,
	CardTitle,
	CoverArea,
	KindBadge,
	KindCard,
	MutedMono,
	ProgressBar,
	Sparkline,
	StarRating,
	StatCell,
	StepTracker,
	formatPrice,
	maybeTimeAgo,
	toArray,
	toNumberOr,
	toStringArray,
	toStringOr
} from './kindPrimitives';

// Commerce & money kinds — buying, selling, tracking, and budgeting.

// ————— 🛍️ product —————

type ProductValue = {
	name: string;
	price: number | null;
	compareAt: number | null;
	currency: string;
	rating: number | null;
	reviewCount: number | null;
	image: string | null;
	inStock: boolean;
	variants: string[];
};

const ProductRenderer = ({ value }: { value: ProductValue; context: KindRenderContext }) => (
	<KindCard padding={0}>
		<CoverArea emoji="🛍️" image={value.image} height="130px">
			{!value.inStock ? (
				<Flex position="absolute" top={2} left={2}>
					<KindBadge tone="danger">Out of stock</KindBadge>
				</Flex>
			) : null}
		</CoverArea>
		<Box padding={4}>
			<CardTitle size="sm">{value.name}</CardTitle>
			<Flex alignItems="baseline" columnGap={2} marginTop={1}>
				<Text color="var(--tt-ink, #16161a)" fontSize="lg" fontWeight={800}>
					{formatPrice(value.price, value.currency)}
				</Text>
				{value.compareAt !== null && value.price !== null && value.compareAt > value.price ? (
					<Text color="var(--tt-muted, #9a9aa6)" fontSize="sm" textDecoration="line-through">
						{formatPrice(value.compareAt, value.currency)}
					</Text>
				) : null}
			</Flex>
			{value.rating !== null ? (
				<Box marginTop={1}>
					<StarRating rating={value.rating} count={value.reviewCount} />
				</Box>
			) : null}
			{value.variants.length ? (
				<Flex columnGap={1.5} flexWrap="wrap" marginTop={2} rowGap={1.5}>
					{value.variants.map((variant) => (
						<KindBadge key={variant}>{variant}</KindBadge>
					))}
				</Flex>
			) : null}
		</Box>
	</KindCard>
);

// ————— 🧾 order —————

type OrderValue = {
	orderNumber: string;
	items: Array<{ name: string; qty: number; price: number | null }>;
	currency: string;
	subtotal: number | null;
	shipping: number | null;
	total: number | null;
	status: string;
};

const OrderRenderer = ({ value }: { value: OrderValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" justifyContent="space-between">
			<CardTitle size="sm">🧾 Order {value.orderNumber}</CardTitle>
			{value.status ? <KindBadge tone={value.status.toLowerCase() === 'delivered' ? 'positive' : 'info'}>{value.status}</KindBadge> : null}
		</Flex>
		<Flex flexDirection="column" marginTop={2}>
			{value.items.map((item, idx) => (
				<Flex key={idx} borderTop={idx === 0 ? 'none' : '1px solid var(--tt-border-light, #f0f0f2)'} columnGap={3} justifyContent="space-between" paddingY={1.5}>
					<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
						{item.qty > 1 ? `${item.qty} × ` : ''}
						{item.name}
					</Text>
					<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={650}>
						{item.price !== null ? formatPrice(item.price * (item.qty || 1), value.currency) : ''}
					</Text>
				</Flex>
			))}
		</Flex>
		<Box borderTop="1px dashed var(--tt-border, #ececef)" marginTop={1} paddingTop={2}>
			{value.subtotal !== null ? (
				<Flex justifyContent="space-between">
					<MutedMono>Subtotal</MutedMono>
					<MutedMono>{formatPrice(value.subtotal, value.currency)}</MutedMono>
				</Flex>
			) : null}
			{value.shipping !== null ? (
				<Flex justifyContent="space-between">
					<MutedMono>Shipping</MutedMono>
					<MutedMono>{formatPrice(value.shipping, value.currency)}</MutedMono>
				</Flex>
			) : null}
			{value.total !== null ? (
				<Flex justifyContent="space-between" marginTop={1}>
					<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={800}>
						Total
					</Text>
					<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={800}>
						{formatPrice(value.total, value.currency)}
					</Text>
				</Flex>
			) : null}
		</Box>
	</KindCard>
);

// ————— 📦 shipment —————

type ShipmentValue = { carrier: string; trackingNumber: string; status: string; steps: string[]; currentStep: number; eta: string };

const ShipmentRenderer = ({ value }: { value: ShipmentValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" justifyContent="space-between">
			<CardTitle size="sm">📦 {value.status}</CardTitle>
			{value.eta ? <KindBadge tone="info">ETA {value.eta}</KindBadge> : null}
		</Flex>
		<Flex columnGap={2} marginTop={0.5}>
			{value.carrier ? <MutedMono>{value.carrier}</MutedMono> : null}
			{value.trackingNumber ? <MutedMono>· {value.trackingNumber}</MutedMono> : null}
		</Flex>
		<Box marginTop={4}>
			<StepTracker steps={value.steps} currentIndex={value.currentStep} />
		</Box>
	</KindCard>
);

// ————— 🎟️ coupon —————

type CouponValue = { code: string; discount: string; description: string; expiresAt: string; brand: string };

const CouponRenderer = ({ value }: { value: CouponValue; context: KindRenderContext }) => (
	<Box border="2px dashed var(--tt-accent, hotpink)" borderRadius="var(--tt-radius-lg, 16px)" background="var(--tt-accent-tint, #fff5fa)" padding={4} width="100%">
		<Flex alignItems="center" columnGap={3} justifyContent="space-between" flexWrap="wrap" rowGap={2}>
			<Box>
				<Text color="var(--tt-accent, hotpink)" fontSize="xl" fontWeight={900} letterSpacing="-0.01em">
					{value.discount}
				</Text>
				<BodyText>{value.description}</BodyText>
				<Flex columnGap={2} marginTop={1}>
					{value.brand ? <MutedMono>{value.brand}</MutedMono> : null}
					{value.expiresAt ? <MutedMono>· expires {value.expiresAt}</MutedMono> : null}
				</Flex>
			</Box>
			<Box background="var(--tt-card, #ffffff)" border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-sm, 9px)" paddingX={3} paddingY={2}>
				<Text color="var(--tt-ink, #16161a)" fontFamily="var(--tt-font-mono, monospace)" fontSize="md" fontWeight={800} letterSpacing="0.08em">
					{value.code}
				</Text>
			</Box>
		</Flex>
	</Box>
);

// ————— 💝 donation —————

type DonationValue = { title: string; raised: number | null; goal: number | null; currency: string; supporters: number | null; description: string };

const DonationRenderer = ({ value }: { value: DonationValue; context: KindRenderContext }) => {
	const percent = value.raised !== null && value.goal ? Math.min(100, Math.round((value.raised / value.goal) * 100)) : 0;

	return (
		<KindCard>
			<CardTitle size="sm">💝 {value.title}</CardTitle>
			<BodyText lines={2}>{value.description}</BodyText>
			<Box marginTop={3}>
				<Flex alignItems="baseline" justifyContent="space-between" marginBottom={1.5}>
					<Text color="var(--tt-ink, #16161a)" fontSize="md" fontWeight={800}>
						{value.raised !== null ? formatPrice(value.raised, value.currency) : '—'}
					</Text>
					<MutedMono>of {value.goal !== null ? formatPrice(value.goal, value.currency) : '—'} · {percent}%</MutedMono>
				</Flex>
				<ProgressBar value={percent} tone="positive" />
				{value.supporters !== null ? (
					<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" marginTop={1.5}>
						🤝 {value.supporters.toLocaleString()} supporters
					</Text>
				) : null}
			</Box>
		</KindCard>
	);
};

// ————— 🔁 subscription —————

type SubscriptionValue = { plan: string; price: number | null; currency: string; period: string; features: string[]; highlight: boolean };

const SubscriptionRenderer = ({ value }: { value: SubscriptionValue; context: KindRenderContext }) => (
	<Box
		{...{
			background: 'var(--tt-card, #ffffff)',
			border: value.highlight ? '2px solid var(--tt-accent, hotpink)' : '1px solid var(--tt-border, #ececef)',
			borderRadius: 'var(--tt-radius-lg, 16px)',
			boxShadow: 'var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))',
			padding: 4,
			position: 'relative',
			width: '100%'
		}}
	>
		{value.highlight ? (
			<Box position="absolute" top="-11px" left="50%" transform="translateX(-50%)">
				<KindBadge tone="accent">Most popular</KindBadge>
			</Box>
		) : null}
		<CardTitle size="sm">{value.plan}</CardTitle>
		<Flex alignItems="baseline" columnGap={1} marginTop={1}>
			<Text color="var(--tt-ink, #16161a)" fontSize="2xl" fontWeight={900}>
				{formatPrice(value.price, value.currency)}
			</Text>
			{value.period ? <MutedMono>/ {value.period}</MutedMono> : null}
		</Flex>
		<Flex flexDirection="column" marginTop={2.5} rowGap={1.5}>
			{value.features.map((feature) => (
				<Flex key={feature} columnGap={2} alignItems="baseline">
					<Text color="var(--tt-positive, #2f8f4f)" fontSize="xs">
						✓
					</Text>
					<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
						{feature}
					</Text>
				</Flex>
			))}
		</Flex>
	</Box>
);

// ————— 📉 stock —————

type StockValue = { symbol: string; name: string; price: number | null; currency: string; changePercent: number | null; series: number[] };

const StockRenderer = ({ value }: { value: StockValue; context: KindRenderContext }) => {
	const positive = (value.changePercent ?? 0) >= 0;

	return (
		<KindCard>
			<Flex alignItems="flex-start" justifyContent="space-between" columnGap={3}>
				<Box>
					<CardTitle size="sm">{value.symbol}</CardTitle>
					<MutedMono>{value.name}</MutedMono>
				</Box>
				<Box textAlign="right">
					<Text color="var(--tt-ink, #16161a)" fontSize="lg" fontWeight={800}>
						{value.price !== null ? formatPrice(value.price, value.currency) : '—'}
					</Text>
					{value.changePercent !== null ? (
						<Text color={positive ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-danger, #d6455a)'} fontSize="sm" fontWeight={800}>
							{positive ? '▲' : '▼'} {Math.abs(value.changePercent)}%
						</Text>
					) : null}
				</Box>
			</Flex>
			{value.series.length ? (
				<Box marginTop={2}>
					<Sparkline positive={positive} series={value.series} />
				</Box>
			) : null}
		</KindCard>
	);
};

// ————— 💰 budget —————

type BudgetValue = { title: string; currency: string; categories: Array<{ label: string; spent: number; budget: number }> };

const BudgetRenderer = ({ value }: { value: BudgetValue; context: KindRenderContext }) => (
	<KindCard>
		{value.title ? <CardTitle size="sm">💰 {value.title}</CardTitle> : null}
		<Flex flexDirection="column" marginTop={2} rowGap={2.5}>
			{value.categories.map((category) => {
				const over = category.spent > category.budget;

				return (
					<Box key={category.label}>
						<Flex justifyContent="space-between" marginBottom={1}>
							<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={650}>
								{category.label}
							</Text>
							<Text color={over ? 'var(--tt-danger, #d6455a)' : 'var(--tt-muted, #9a9aa6)'} fontSize="xs" fontWeight={700}>
								{formatPrice(category.spent, value.currency)} / {formatPrice(category.budget, value.currency)}
							</Text>
						</Flex>
						<ProgressBar value={category.spent} max={category.budget} tone={over ? 'accent' : 'positive'} />
					</Box>
				);
			})}
		</Flex>
	</KindCard>
);

// ————— 🏠 property —————

type PropertyValue = { title: string; price: number | null; currency: string; beds: number | null; baths: number | null; area: string; address: string; image: string | null; forRent: boolean };

const PropertyRenderer = ({ value }: { value: PropertyValue; context: KindRenderContext }) => (
	<KindCard padding={0}>
		<CoverArea emoji="🏠" image={value.image} height="140px" gradient="linear-gradient(135deg, #e8f4ea 0%, #dcecf7 100%)">
			<Flex position="absolute" top={2} left={2}>
				<KindBadge tone={value.forRent ? 'info' : 'positive'}>{value.forRent ? 'For rent' : 'For sale'}</KindBadge>
			</Flex>
		</CoverArea>
		<Box padding={4}>
			<Flex alignItems="baseline" columnGap={1}>
				<Text color="var(--tt-ink, #16161a)" fontSize="lg" fontWeight={800}>
					{formatPrice(value.price, value.currency)}
				</Text>
				{value.forRent ? <MutedMono>/ week</MutedMono> : null}
			</Flex>
			<CardTitle size="sm">{value.title}</CardTitle>
			{value.address ? <MutedMono>📍 {value.address}</MutedMono> : null}
			<Flex columnGap={5} marginTop={3}>
				{value.beds !== null ? <StatCell label="beds" value={`🛏 ${value.beds}`} /> : null}
				{value.baths !== null ? <StatCell label="baths" value={`🛁 ${value.baths}`} /> : null}
				{value.area ? <StatCell label="area" value={`📐 ${value.area}`} /> : null}
			</Flex>
		</Box>
	</KindCard>
);

// ————— 🍽️ menu —————

type MenuValue = { title: string; currency: string; sections: Array<{ name: string; items: Array<{ name: string; price: number | null; description: string }> }> };

const MenuRenderer = ({ value }: { value: MenuValue; context: KindRenderContext }) => (
	<KindCard>
		{value.title ? (
			<Text color="var(--tt-ink, #16161a)" fontSize="md" fontWeight={800} marginBottom={2} textAlign="center">
				🍽️ {value.title}
			</Text>
		) : null}
		<Flex flexDirection="column" rowGap={3}>
			{value.sections.map((section) => (
				<Box key={section.name}>
					<Text color="var(--tt-muted, #9a9aa6)" fontSize="10px" fontWeight={800} letterSpacing="0.14em" textTransform="uppercase" marginBottom={1.5}>
						{section.name}
					</Text>
					<Flex flexDirection="column" rowGap={1.5}>
						{section.items.map((item) => (
							<Box key={item.name}>
								<Flex alignItems="baseline" columnGap={2}>
									<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={700} flexShrink={0}>
										{item.name}
									</Text>
									<Box borderBottom="1px dotted var(--tt-faint, #b6b6c0)" flex="1" transform="translateY(-3px)" />
									<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={800} flexShrink={0}>
										{item.price !== null ? formatPrice(item.price, value.currency) : ''}
									</Text>
								</Flex>
								{item.description ? (
									<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs">
										{item.description}
									</Text>
								) : null}
							</Box>
						))}
					</Flex>
				</Box>
			))}
		</Flex>
	</KindCard>
);

// ————— registration —————
// Explicit registration, called lazily by kindRegistry: "sideEffects": false would
// tree-shake a bare side-effect import out of production builds.

export const registerCommerceKinds = () => {

registerKindRenderer({
	kind: 'product',
	title: 'Product',
	emoji: '🛍️',
	description: 'E-commerce card — price, compare-at, rating, variants, stock.',
	category: 'Commerce',
	aliases: ['item', 'sku'],
	match: (thing) => toNumberOr(thing.price) !== null && ('rating' in thing || 'variants' in thing || 'inStock' in thing),
	adapt: (thing): ProductValue | null => {
		const name = toStringOr(thing.name, toStringOr(thing.title));
		if (!name) return null;
		return {
			name,
			price: toNumberOr(thing.price),
			compareAt: toNumberOr(thing.compareAt, toNumberOr(thing.wasPrice)),
			currency: toStringOr(thing.currency, 'USD'),
			rating: toNumberOr(thing.rating),
			reviewCount: toNumberOr(thing.reviewCount, toNumberOr(thing.reviews)),
			image: toStringOr(thing.image) || null,
			inStock: thing.inStock !== false,
			variants: toStringArray(thing.variants)
		};
	},
	render: ProductRenderer
});

registerKindRenderer({
	kind: 'order',
	title: 'Order / receipt',
	emoji: '🧾',
	description: 'Line items with quantities, totals, and status.',
	category: 'Commerce',
	aliases: ['receipt', 'invoice', 'purchase'],
	match: (thing) => ('orderNumber' in thing || 'total' in thing) && Array.isArray(thing.items),
	adapt: (thing): OrderValue | null => {
		const items = toArray(thing.items).map((item) => {
			const record = (item || {}) as Record<string, unknown>;
			return {
				name: toStringOr(record.name, toStringOr(record.title, 'Item')),
				qty: toNumberOr(record.qty, toNumberOr(record.quantity, 1)) || 1,
				price: toNumberOr(record.price)
			};
		});
		if (!items.length) return null;
		return {
			orderNumber: toStringOr(thing.orderNumber, toStringOr(thing.number, '#')),
			items,
			currency: toStringOr(thing.currency, 'USD'),
			subtotal: toNumberOr(thing.subtotal),
			shipping: toNumberOr(thing.shipping),
			total: toNumberOr(thing.total),
			status: toStringOr(thing.status)
		};
	},
	render: OrderRenderer
});

registerKindRenderer({
	kind: 'shipment',
	title: 'Shipment tracking',
	emoji: '📦',
	description: 'Carrier, tracking number, and a step tracker to delivery.',
	category: 'Commerce',
	aliases: ['tracking', 'delivery', 'package'],
	match: (thing) => 'trackingNumber' in thing || ('carrier' in thing && 'status' in thing),
	adapt: (thing): ShipmentValue | null => {
		const steps = toStringArray(thing.steps);
		const defaultSteps = ['Ordered', 'Packed', 'Shipped', 'Out for delivery', 'Delivered'];
		const useSteps = steps.length >= 2 ? steps : defaultSteps;
		const status = toStringOr(thing.status, 'In transit');
		const explicit = toNumberOr(thing.currentStep);
		const byStatus = useSteps.findIndex((step) => step.toLowerCase() === status.toLowerCase());

		return {
			carrier: toStringOr(thing.carrier),
			trackingNumber: toStringOr(thing.trackingNumber),
			status,
			steps: useSteps,
			currentStep: explicit !== null ? explicit : byStatus >= 0 ? byStatus : 2,
			eta: toStringOr(thing.eta)
		};
	},
	render: ShipmentRenderer
});

registerKindRenderer({
	kind: 'coupon',
	title: 'Coupon',
	emoji: '🎟️',
	description: 'Dashed-border voucher with a mono promo code.',
	category: 'Commerce',
	aliases: ['promo', 'voucher', 'discount'],
	match: (thing) => typeof thing.code === 'string' && ('discount' in thing || 'expiresAt' in thing),
	adapt: (thing): CouponValue | null => {
		const code = toStringOr(thing.code);
		if (!code) return null;
		return {
			code,
			discount: toStringOr(thing.discount, toStringOr(thing.amount, 'Deal')),
			description: toStringOr(thing.description),
			expiresAt: toStringOr(thing.expiresAt, toStringOr(thing.expiry)),
			brand: toStringOr(thing.brand, toStringOr(thing.store))
		};
	},
	render: CouponRenderer
});

registerKindRenderer({
	kind: 'donation',
	title: 'Fundraiser',
	emoji: '💝',
	description: 'Raised vs goal with a progress bar and supporter count.',
	category: 'Commerce',
	aliases: ['fundraiser', 'campaign', 'crowdfund'],
	match: (thing) => toNumberOr(thing.raised) !== null && toNumberOr(thing.goal) !== null,
	adapt: (thing): DonationValue | null => {
		const title = toStringOr(thing.title, toStringOr(thing.name));
		if (!title) return null;
		return {
			title,
			raised: toNumberOr(thing.raised),
			goal: toNumberOr(thing.goal),
			currency: toStringOr(thing.currency, 'USD'),
			supporters: toNumberOr(thing.supporters, toNumberOr(thing.backers)),
			description: toStringOr(thing.description)
		};
	},
	render: DonationRenderer
});

registerKindRenderer({
	kind: 'subscription',
	title: 'Subscription plan',
	emoji: '🔁',
	description: 'Pricing-page plan card — price per period + feature ticks.',
	category: 'Commerce',
	aliases: ['plan', 'pricing', 'tier'],
	match: (thing) => 'plan' in thing && toNumberOr(thing.price) !== null,
	adapt: (thing): SubscriptionValue | null => {
		const plan = toStringOr(thing.plan, toStringOr(thing.name));
		if (!plan) return null;
		return {
			plan,
			price: toNumberOr(thing.price),
			currency: toStringOr(thing.currency, 'USD'),
			period: toStringOr(thing.period, toStringOr(thing.interval, 'month')),
			features: toStringArray(thing.features),
			highlight: thing.highlight === true || thing.popular === true
		};
	},
	render: SubscriptionRenderer
});

registerKindRenderer({
	kind: 'stock',
	title: 'Stock / ticker',
	emoji: '📉',
	description: 'Symbol, live-style price, change %, and sparkline.',
	category: 'Commerce',
	aliases: ['ticker', 'share', 'crypto', 'coin'],
	match: (thing) => typeof thing.symbol === 'string' && toNumberOr(thing.price) !== null,
	adapt: (thing): StockValue | null => {
		const symbol = toStringOr(thing.symbol).toUpperCase();
		if (!symbol) return null;
		return {
			symbol,
			name: toStringOr(thing.name),
			price: toNumberOr(thing.price),
			currency: toStringOr(thing.currency, 'USD'),
			changePercent: toNumberOr(thing.changePercent, toNumberOr(thing.change)),
			series: toArray(thing.series).map((v) => toNumberOr(v, 0) || 0)
		};
	},
	render: StockRenderer
});

registerKindRenderer({
	kind: 'budget',
	title: 'Budget',
	emoji: '💰',
	description: 'Spending categories as spent-vs-budget bars.',
	category: 'Commerce',
	aliases: ['expenses', 'spending'],
	match: (thing) =>
		Array.isArray(thing.categories) &&
		toArray(thing.categories).every((category) => category && typeof category === 'object' && 'spent' in (category as Record<string, unknown>)),
	adapt: (thing): BudgetValue | null => {
		const categories = toArray(thing.categories)
			.map((category) => {
				const record = (category || {}) as Record<string, unknown>;
				return {
					label: toStringOr(record.label, toStringOr(record.name)),
					spent: toNumberOr(record.spent, 0) || 0,
					budget: toNumberOr(record.budget, toNumberOr(record.limit, 0)) || 0
				};
			})
			.filter((category) => category.label);
		if (!categories.length) return null;
		return { title: toStringOr(thing.title, toStringOr(thing.name)), currency: toStringOr(thing.currency, 'USD'), categories };
	},
	render: BudgetRenderer
});

registerKindRenderer({
	kind: 'property',
	title: 'Property',
	emoji: '🏠',
	description: 'Real-estate card — price, beds/baths/area, address.',
	category: 'Commerce',
	aliases: ['real-estate', 'house', 'rental'],
	match: (thing) => ('beds' in thing || 'bedrooms' in thing) && ('price' in thing || 'rent' in thing),
	adapt: (thing): PropertyValue | null => {
		const title = toStringOr(thing.title, toStringOr(thing.name, toStringOr(thing.address)));
		if (!title) return null;
		return {
			title,
			price: toNumberOr(thing.price, toNumberOr(thing.rent)),
			currency: toStringOr(thing.currency, 'USD'),
			beds: toNumberOr(thing.beds, toNumberOr(thing.bedrooms)),
			baths: toNumberOr(thing.baths, toNumberOr(thing.bathrooms)),
			area: toStringOr(thing.area, toStringOr(thing.sqm)),
			address: toStringOr(thing.address),
			image: toStringOr(thing.image) || null,
			forRent: thing.forRent === true || 'rent' in thing
		};
	},
	render: PropertyRenderer
});

registerKindRenderer({
	kind: 'menu',
	title: 'Menu',
	emoji: '🍽️',
	description: 'Restaurant menu — sections with dotted price leaders.',
	category: 'Commerce',
	aliases: ['restaurant-menu', 'carte'],
	match: (thing) =>
		Array.isArray(thing.sections) &&
		toArray(thing.sections).every((section) => section && typeof section === 'object' && Array.isArray((section as Record<string, unknown>).items)),
	adapt: (thing): MenuValue | null => {
		const sections = toArray(thing.sections)
			.map((section) => {
				const record = (section || {}) as Record<string, unknown>;
				return {
					name: toStringOr(record.name, toStringOr(record.title, 'Menu')),
					items: toArray(record.items).map((item) => {
						const itemRecord = (item || {}) as Record<string, unknown>;
						return {
							name: toStringOr(itemRecord.name, toStringOr(itemRecord.title, 'Dish')),
							price: toNumberOr(itemRecord.price),
							description: toStringOr(itemRecord.description)
						};
					})
				};
			})
			.filter((section) => section.items.length);
		if (!sections.length) return null;
		return { title: toStringOr(thing.title, toStringOr(thing.name)), currency: toStringOr(thing.currency, 'USD'), sections };
	},
	render: MenuRenderer
});

};
