// Catches all uncaught errors so process never dies
process.on('uncaughtException', err => {
	console.log('Caught exception: ', err);
});

import dotenv from 'dotenv'
dotenv.config()
import bodyParser from 'body-parser'
import express from 'express'
import cors from 'cors'
import http from 'http'
const app = express()
const server = http.createServer(app);
app.use(bodyParser.json())
const port = process.env.PORT
import axios from 'axios'
import pug from 'pug'
import { DateTime } from 'luxon'
import bcrypt from 'bcrypt'
const saltRounds = 10
import { get } from 'lodash-es'
import { default as s } from 'smarts'
const smarts = s()
import thingtime from 'thingtime'
import { Server } from 'socket.io';

// Cross-origin callers come from an explicit allowlist, never '*' (CodeQL
// js/cors-permissive-configuration). A wildcard let ANY site on the web read
// every response this server produces, including authenticated ones; the
// reflected form below echoes only origins that were configured on purpose,
// so an unlisted site gets no Access-Control-Allow-Origin header at all.
// Set CORS_ORIGINS to a comma-separated list to widen it, e.g.
// CORS_ORIGINS="https://thingtime.app,http://localhost:3000"; unset it and
// only the local dev origins are allowed. A wildcard is deliberately not the
// fallback.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:9999')
	.split(',')
	.map(origin => origin.trim())
	.filter(Boolean)

// `origin` is undefined for same-origin/non-browser callers (curl, server to
// server) — those were never subject to CORS, so they keep working.
const corsOrigin = (origin, callback) => {
	if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
	callback(null, false)
}

const io = new Server(server, {
	cors: {
		origin: corsOrigin,
		methods: ['GET', 'POST'],
	},
})

import { v4 as uuidv4 } from 'uuid'

(async () => {

	await thingtime.init()

	// Express middleware
	app.use(cors({
		origin: corsOrigin,
	}))

	app.get('/', (req, res) => {
		res.status(200).send('Hello ThingTime World!')
	})

	app.get('/v1/thing', async (req, res) => {

		// console.log('req', req.query)

		const { request } = req.query

		if (request === 'get') {

			const { uuid } = req.query

			const thing = await thingtime.get(uuid)

			res.status(200).send({
				thing: smarts.serialize(thing),
			})

		} else {

			let { thing } = req.query
			thing = smarts.parse(thing, { noFunctions: true })

			if (!thing) {
				res.status(400).send('No thing provided')
				return
			}

			await thingtime.save(thing)

			res.status(200).send()
		}

	})

	// socket config
	io.on('connection', socket => {
		console.log('Something with socket id', socket.id, 'connected')

		socket.on('registerListener', msg => {
			console.log('Message from socket with id', socket.id)
			thingtime.registerListener(socket, msg.uuid)
		})

		socket.on('disconnect', () => {
			console.log('Something with socket id', socket.id, 'disconnected')
		})
	});

	app.get('/privacy-policy', async (req, res) => res.status(200).send(pug.compile(`
.privacy-policy(
  style="max-width: 600px margin: 0 auto padding-top: 100px"
)
  h1.title.text-white(
    style='fontSize: 48px fontWeight: bold'
  )
    | Privacy Policy
  p.subtitle
    | The friendly ThingTime API Privacy Policy
  p.answer
    .pt-12 This API uses YouTube API Services
    .pt-12 ThingTime API does not use any analytics tools to store any data, nor does it store any user data of any kind.
    .pt-12 We do not allow any 3rd parties to serve Ads on ThingTime API
  .pt-12 You can contact ThingTime API at
    a(href='emailto:subberAPI@alopu.com', style="padding-left: 6px") subberAPI@alopu.com
  .pt-12
    a.underline(href='https://www.youtube.com/t/terms') YouTube Terms of Service
  .pt-12
    a.underline(href='https://policies.google.com/privacy') Google Privacy Policy
style(type="text/css").
  .pt-12 { padding-top: 12px }
`)()))

	server.listen(port, () => {
		console.log(`Example app listening at http://localhost:${port}`)
	})
})()
