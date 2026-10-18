import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import WebPlatformSurface from '../../app/webPlatform/WebPlatformSurface';
import { mediaConversionProgram } from '../../app/webPlatform/mediaConversionProgram';
const program = mediaConversionProgram();
const router = createMemoryRouter([
	{
		id: 'root',
		path: '/',
		loader: () => ({ user: null }),
		Component: () => (
			<main style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', boxSizing: 'border-box' }}>
				<h1>Local video compressor</h1>
				<p>{program.description}</p>
				<WebPlatformSurface program={program} name="program" />
			</main>
		)
	}
]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
