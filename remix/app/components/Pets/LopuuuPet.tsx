import { Box, Flex, Text } from '@chakra-ui/react';

export const LopuuuPet = () => {
	return (
		<Box
			aria-label="Lopuuuuuuuuuu, your rainbow brain unicorn pet"
			bottom={{ base: 4, md: 6 }}
			pointerEvents="none"
			position="fixed"
			right={{ base: 3, md: 6 }}
			role="img"
			sx={{
				'@keyframes lopuuu-float': {
					'0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(-2deg)' },
					'50%': { transform: 'translate3d(0, -10px, 0) rotate(2deg)' }
				},
				'@keyframes lopuuu-sparkle': {
					'0%, 100%': { opacity: 0.45, transform: 'scale(0.9)' },
					'50%': { opacity: 1, transform: 'scale(1.12)' }
				},
				'@keyframes lopuuu-rainbow': {
					'0%': { filter: 'hue-rotate(0deg)' },
					'100%': { filter: 'hue-rotate(360deg)' }
				}
			}}
			zIndex={20}
		>
			<Flex alignItems="center" animation="lopuuu-float 4.8s ease-in-out infinite" flexDirection="column" gap={1}>
				<Flex
					alignItems="center"
					background="linear-gradient(135deg, rgba(255,255,255,0.94), rgba(255,240,253,0.86))"
					border="1px solid rgba(255,255,255,0.7)"
					borderRadius="999px"
					boxShadow="0 12px 42px rgba(174, 68, 255, 0.28)"
					color="purple.700"
					fontSize={{ base: '10px', md: 'xs' }}
					fontWeight="800"
					gap={1}
					letterSpacing="0.02em"
					px={3}
					py={1}
					textShadow="0 1px 0 rgba(255,255,255,0.8)"
					whiteSpace="nowrap"
				>
					<Text as="span">Lopuuuuuuuuuu</Text>
					<Text as="span">💖</Text>
				</Flex>

				<Box position="relative">
					<Text
						animation="lopuuu-rainbow 7s linear infinite"
						fontSize={{ base: '56px', md: '74px' }}
						lineHeight="1"
						textShadow="0 10px 28px rgba(120, 44, 255, 0.35)"
					>
						🦄
					</Text>
					<Text
						animation="lopuuu-sparkle 1.8s ease-in-out infinite"
						fontSize={{ base: '18px', md: '24px' }}
						left="-16px"
						position="absolute"
						top="2px"
					>
						✨
					</Text>
					<Text
						animation="lopuuu-sparkle 2.3s ease-in-out infinite 0.35s"
						fontSize={{ base: '18px', md: '24px' }}
						position="absolute"
						right="-18px"
						top="16px"
					>
						🧠
					</Text>
					<Text
						animation="lopuuu-sparkle 2s ease-in-out infinite 0.7s"
						bottom="0"
						fontSize={{ base: '18px', md: '22px' }}
						position="absolute"
						right="-12px"
					>
						🌈
					</Text>
				</Box>
			</Flex>
		</Box>
	);
};
