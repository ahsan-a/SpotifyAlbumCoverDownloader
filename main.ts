import { Albums } from './types.ts';
import { load } from 'https://deno.land/std@0.196.0/dotenv/mod.ts';
import { download } from 'https://deno.land/x/download@v2.0.2/mod.ts';
import { default as sanitizeFilename } from 'https://deno.land/x/sanitize_filename@1.2.1/mod.ts';

const { client_id, client_secret } = await load();

const ac = new AbortController();
let code: string;

Deno.serve({
	port: 8080,
	signal: ac.signal,
	handler: (req) => {
		code = req.url.split('=')[1];
		reqAccessToken(code);
		return new Response('Auth code obtained. This window can be closed.');
	},
});

await new Deno.Command('cmd', {
	args: [
		'/c',
		'start',
		'',
		`https://accounts.spotify.com/authorize?${new URLSearchParams({
			client_id,
			response_type: 'code',
			redirect_uri: 'http://localhost:8080',
			scope: 'user-library-read',
		})}`.replaceAll(/&/g, '"&"'),
	],
	stdout: 'piped',
	stderr: 'piped',
	windowsRawArguments: true,
}).output();

async function reqAccessToken(code: string) {
	if (!code) return;
	const res = await (
		await fetch('https://accounts.spotify.com/api/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: 'Basic ' + btoa(client_id + ':' + client_secret),
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: 'http://localhost:8080',
			}),
		})
	).json();
	await getAlbumCovers(res.access_token);
}

const fetchAlbums = async (access_token: string, offset = 0, limit = 10): Promise<Albums> =>
	await (
		await fetch(`https://api.spotify.com/v1/me/albums?limit=${limit}&market=GB&offset=${offset}`, {
			headers: {
				Authorization: `Bearer ${access_token}`,
			},
		})
	).json();

async function getAlbumCovers(access_token: string) {
	const res = await fetchAlbums(access_token);

	const images: { name: string; url: string }[] = [];
	res.items.forEach((album) => images.push({ name: album.album.name, url: album.album.images[0].url }));

	if (res.total > res.limit) {
		const iterations = Math.floor(res.total / res.limit);

		for (let i = 0; i < iterations; i++) {
			const albums = await fetchAlbums(access_token, (i + 1) * res.limit);
			albums.items.forEach((album) => images.push({ name: album.album.name, url: album.album.images[0].url }));
		}
	}
	await Deno.mkdir('covers').catch(() => {});
	for (const image of images) {
		await download(image.url, { dir: './covers', file: `${sanitizeFilename(image.name)}.jfif` });
	}
	console.log('Album covers downloaded successfully.');
	Deno.exit(0);
}
