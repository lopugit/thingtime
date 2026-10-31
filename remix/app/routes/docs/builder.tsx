import React from 'react';
import { Box, Heading, Text, Flex, Link, Stack } from '@chakra-ui/react';
import { Link as RouterLink, useParams } from 'react-router';
import { builderGuideSections } from '~/docs/builderGuide';
import { CodeBlock } from './docsCode';

export default function BuilderDocs() {
	const { section } = useParams();
	const selected = builderGuideSections.find((entry) => entry.id === section);
	return (
		<Box maxW="1080px" mx="auto" width="100%" minW={0} px={{ base: 4, md: 8 }} py={8}>
			<Text fontSize="sm" color="var(--tt-muted)">
				Builder / Components SDK
			</Text>
			<Heading as="h1" size="xl" mt={2}>
				Build forms that work
			</Heading>
			<Text mt={4} maxW="720px">
				Connect inputs, private files, saved Things and external lookups. These examples also guide Lopu when it builds for you.
			</Text>
			<Flex as="nav" aria-label="Builder documentation" gap={2} wrap="wrap" my={6}>
				<Link as={RouterLink} to="/docs/builder" p={2} borderWidth="1px" borderRadius="md">
					Overview
				</Link>
				{builderGuideSections.map((entry) => (
					<Link
						as={RouterLink}
						key={entry.id}
						to={`/docs/builder/${entry.id}`}
						aria-current={section === entry.id ? 'page' : undefined}
						p={2}
						borderWidth="1px"
						borderRadius="md"
						fontWeight={section === entry.id ? 700 : 400}
					>
						{entry.title}
					</Link>
				))}
			</Flex>
			{section && !selected ? (
				<Text role="alert">Section not found. Choose a topic above.</Text>
			) : (
				<Stack spacing={10}>
					{(selected ? [selected] : builderGuideSections).map((entry) => (
						<Box as="section" key={entry.id} id={entry.id} minW={0}>
							<Heading as="h2" size="md" mb={4}>
								<Link as={RouterLink} to={`/docs/builder/${entry.id}`}>
									{entry.title}
								</Link>
							</Heading>
							<Stack spacing={3}>
								{entry.paragraphs.map((paragraph) => (
									<Text key={paragraph} lineHeight={1.8} overflowWrap="anywhere">
										{paragraph}
									</Text>
								))}
							</Stack>
							{entry.example && (
								<Box mt={4} maxW="100%" overflowX="auto">
									<CodeBlock language="json">{JSON.stringify(entry.example, null, 2)}</CodeBlock>
								</Box>
							)}
							{entry.id === 'lookups' && (
								<Flex mt={4} gap={4} wrap="wrap">
									<Link href="https://developers.google.com/maps/documentation/geocoding/requests-geocoding" isExternal>
										Google geocoding reference
									</Link>
									<Link href="https://developers.google.com/maps/documentation/geocoding/policies" isExternal>
										Google display and storage rules
									</Link>
								</Flex>
							)}
						</Box>
					))}
				</Stack>
			)}
			<Link as={RouterLink} to="/builder" display="inline-block" mt={8}>
				Open Builder →
			</Link>
		</Box>
	);
}
