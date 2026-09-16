import React from 'react';
import { Box, Button, Flex, Link, Select, Text, Textarea } from '@chakra-ui/react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import { PageHeader, PageShell } from '~/components/Layout/PageShell';
import { useLopu } from '~/components/Lopu/useLopu';
import { legalDocuments, legalDocumentPath, legalDocumentText, resolveLegalDocument } from '~/legal/documents';
import type { LegalDocument } from '~/legal/documents';

const card = { border: '1px solid var(--tt-border, #e4e4e7)', borderRadius: '16px', background: 'var(--tt-card, white)', padding: [4, 6] };
const DocumentLink = ({ doc }: { doc: LegalDocument }) => (
	<Link as={RouterLink} to={legalDocumentPath(doc)} fontWeight={600}>
		{doc.title}
	</Link>
);

function ExportActions({ doc }: { doc: LegalDocument }) {
	const lopu = useLopu();
	const exportId = React.useId();
	const [manual, setManual] = React.useState<string | null>(null);
	React.useEffect(() => setManual(null), [doc]);
	const copy = async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setManual(null);
			lopu({ title: `${label} copied`, status: 'success', duration: 3000 });
		} catch {
			setManual(text);
			lopu({ title: 'Select and copy the text below', description: 'Clipboard access is unavailable in this browser.', status: 'info' });
		}
	};
	const text = legalDocumentText(doc);
	const download = () => {
		const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `thingtime-${doc.slug}-${doc.version}.txt`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};
	return (
		<Box>
			<Flex gap={2} flexWrap="wrap">
				<Button size="sm" onClick={() => copy(text, 'Policy text')}>
					Copy text
				</Button>
				<Button size="sm" variant="outline" onClick={() => copy(`https://thingtime.com${legalDocumentPath(doc)}`, 'Public URL')}>
					Copy public URL
				</Button>
				<Button size="sm" variant="outline" onClick={download}>
					Download .txt
				</Button>
			</Flex>
			{manual !== null && (
				<Box mt={4}>
					<Text as="label" htmlFor={exportId} fontSize="sm">
						Select all and copy
					</Text>
					<Textarea id={exportId} value={manual} readOnly onFocus={(event) => event.target.select()} rows={8} />
				</Box>
			)}
		</Box>
	);
}

export default function LegalRoute() {
	const { slug, version } = useParams();
	const navigate = useNavigate();
	const doc = slug ? resolveLegalDocument(slug, version) : undefined;
	React.useEffect(() => {
		const previous = document.title;
		const prefix = window.location.hostname === 'thingtime.com' || window.location.hostname === 'www.thingtime.com' ? '' : '[Preview] ';
		document.title = `${prefix}${slug ? doc?.title ?? 'Legal document not found' : 'Legal'} · Thingtime`;
		window.scrollTo(0, 0);
		return () => {
			document.title = previous;
		};
	}, [slug, version, doc]);
	if (slug && !doc)
		return (
			<PageShell>
				<PageHeader eyebrow="Thingtime legal" title="Document not found" subtitle="That document or version is not available." />
				<Link as={RouterLink} to="/legal">
					Back to legal directory
				</Link>
			</PageShell>
		);
	if (doc) {
		const versions = legalDocuments.filter((entry) => entry.slug === doc.slug);
		return (
			<PageShell width={760}>
				<Box pt={4}>
					<Link as={RouterLink} to="/legal" fontSize="sm">
						← Legal directory
					</Link>
				</Box>
				<PageHeader
					eyebrow={doc.status === 'archived' ? 'Historical archive' : 'Thingtime legal'}
					title={doc.title}
					variant="ink"
					subtitle={doc.scope}
				/>
				<Text fontSize="sm">
					Version {doc.version} · Effective <time dateTime={doc.effectiveDate}>{doc.effectiveDate}</time> ·{' '}
					{doc.status === 'current' ? 'Current' : 'Archived'}
				</Text>
				{doc.status === 'archived' && (
					<Box {...card}>
						<Text fontWeight={600}>Archived document</Text>
						<Text>{doc.summary}</Text>
						{resolveLegalDocument(doc.slug) && (
							<Link as={RouterLink} to={`/pages/${doc.slug}`}>
								Read the current policy
							</Link>
						)}
					</Box>
				)}
				<Box {...card}>
					<ExportActions doc={doc} />
					{doc.slug === 'apple-tv-privacy-policy' && doc.status === 'current' && (
						<Text mt={3} fontSize="sm">
							Use “Copy text” for the Apple TV Privacy Policy field in App Store Connect.
						</Text>
					)}
					{doc.slug === 'privacy-policy' && doc.status === 'current' && (
						<Text mt={3} fontSize="sm">
							Use “Copy public URL” for Apple’s Privacy Policy URL field.
						</Text>
					)}
					<Box mt={4}>
						<Text as="label" htmlFor="legal-version" fontSize="sm">
							Document version
						</Text>
						<Select id="legal-version" value={doc.version} onChange={(event) => navigate(`/pages/${doc.slug}/${event.target.value}`)} mt={1}>
							{versions.map((entry) => (
								<option key={entry.version} value={entry.version}>
									{entry.version} · {entry.effectiveDate} · {entry.status}
								</option>
							))}
						</Select>
					</Box>
					<Link as={RouterLink} to={legalDocumentPath(doc, true)} display="inline-block" mt={3} fontSize="sm">
						Permanent link to this version
					</Link>
				</Box>
				<Box as="article" {...card} lineHeight="1.8" sx={{ overflowWrap: 'anywhere' }}>
					{doc.sections.map((section, index) => (
						<Box as="section" key={section.heading} mt={index ? 8 : 0}>
							<Text as="h2" fontSize="lg" fontWeight={600} mb={3}>
								{section.heading}
							</Text>
							{section.paragraphs.map((paragraph, p) => (
								<Text key={p} mt={p ? 3 : 0} whiteSpace="pre-line">
									{paragraph}
								</Text>
							))}
						</Box>
					))}
				</Box>
				<Link as={RouterLink} to="/legal">
					All legal documents and versions
				</Link>
			</PageShell>
		);
	}
	return (
		<PageShell width={860}>
			<PageHeader
				eyebrow="Thingtime"
				title="Legal"
				variant="ink"
				subtitle="Our policies, terms and their history. Read a document, copy its text or download a plain-text version."
			/>
			<Box {...card}>
				<Text as="h2" fontSize="lg" fontWeight={600}>
					For App Store Connect
				</Text>
				<Text mt={2}>
					Privacy Policy URL: open the Privacy Policy and choose “Copy public URL”. For Apple TV Privacy Policy, open the Apple TV document and choose
					“Copy text”.
				</Text>
				<Text mt={2} fontSize="sm">
					These documents do not fill in Apple’s separate App Privacy data disclosures.
				</Text>
			</Box>
			<Text as="h2" fontSize="lg" fontWeight={600} mt={3}>
				Current documents
			</Text>
			{legalDocuments
				.filter((entry) => entry.status === 'current')
				.map((entry) => (
					<Box key={entry.slug} {...card}>
						<DocumentLink doc={entry} />
						<Text mt={2}>{entry.summary}</Text>
						<Text fontSize="sm" mt={2} mb={4}>
							Version {entry.version} · Effective <time dateTime={entry.effectiveDate}>{entry.effectiveDate}</time> · {entry.scope}
						</Text>
						<ExportActions doc={entry} />
					</Box>
				))}
			<Text as="h2" fontSize="lg" fontWeight={600} mt={5}>
				Version history
			</Text>
			<Text fontSize="sm">Permanent records of each published edition. Archived notices are historical and may not describe current practices.</Text>
			{legalDocuments.map((entry) => (
				<Box key={`${entry.slug}-${entry.version}`} {...card}>
					<Link as={RouterLink} to={legalDocumentPath(entry, true)} fontWeight={600}>
						{entry.title} · {entry.version}
					</Link>
					<Text fontSize="sm" mt={2}>
						{entry.effectiveDate} · {entry.status === 'current' ? 'Current' : 'Archived'} · {entry.scope}
					</Text>
					<Text fontSize="sm" mt={2}>
						{entry.summary}
					</Text>
				</Box>
			))}
			<Text fontSize="sm">
				Questions? <Link href="mailto:contact@thingtime.com">contact@thingtime.com</Link>
			</Text>
		</PageShell>
	);
}
