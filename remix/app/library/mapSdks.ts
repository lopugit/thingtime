import { slug, type LibraryExample, type Recipe } from './types';
export const MAPBOX_SDK_VERSION = '3.30.0';
export const MAPBOX_SCRIPT = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_SDK_VERSION}/mapbox-gl.js`;
export const MAPBOX_STYLES = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_SDK_VERSION}/mapbox-gl.css`;
export const GOOGLE_MAPS_SCRIPT = 'https://maps.googleapis.com/maps/api/js';
const mapboxInput = { longitude: 144.9631, latitude: -37.8136, zoom: 12 };
const googleInput = { lat: -37.8136, lng: 144.9631, zoom: 12 };
const mapboxStart = `const map = new mapboxgl.Map({container:root,accessToken:apiKey,style:'mapbox://styles/mapbox/streets-v12',center:[input.longitude,input.latitude],zoom:input.zoom});
map.addControl(new mapboxgl.NavigationControl());
await new Promise((resolve,reject)=>{map.once('load',resolve);map.once('error',reject)});`;
const googleStart = `const {Map} = await google.maps.importLibrary('maps');
const map = new Map(root,{center:{lat:input.lat,lng:input.lng},zoom:input.zoom,mapId:'DEMO_MAP_ID'});
await new Promise(resolve=>google.maps.event.addListenerOnce(map,'idle',resolve));`;
const placeFields = "['id','displayName','formattedAddress','location','googleMapsURI','attributions']";
// Render returned places as text, links and Google Maps markers; never HTML from a provider.
const placePresentation = `const {Map}=await google.maps.importLibrary('maps');
const {AdvancedMarkerElement}=await google.maps.importLibrary('marker');
const holder=document.createElement('div');holder.style.cssText='height:230px';root.append(holder);
const map=new Map(holder,{center:places[0]?.location||{lat:-37.8136,lng:144.9631},zoom:13,mapId:'DEMO_MAP_ID'});
const list=document.createElement('ul');root.append(list);
for(const place of places){
 if(place.location)new AdvancedMarkerElement({map,position:place.location,title:place.displayName||''});
 const row=document.createElement('li');row.textContent=[place.displayName,place.formattedAddress].filter(Boolean).join(' — ');list.append(row);
 for(const attribution of place.attributions||[]){const credit=document.createElement('span');credit.textContent=' '+attribution.provider;row.append(credit)}
}
return places.map(p=>({id:p.id,name:p.displayName,address:p.formattedAddress,location:p.location?.toJSON(),googleMapsURI:p.googleMapsURI,attributions:p.attributions}));`;
function sdk(provider: string, type: 'mapbox' | 'google-maps', docs: string, recipes: Recipe[], setup: string): LibraryExample[] {
	return recipes.map(([title, input, code, description]) => ({
		id: `${slug(provider)}-${slug(title)}`,
		provider,
		title,
		input,
		code,
		docs,
		setup,
		category: 'Weather & maps',
		kind: 'component',
		visual: true,
		description: description || `${title} using the real ${provider} browser SDK. Edit the inputs, enter your own restricted browser key, then run.`,
		sdk: {
			type,
			accountUrl: type === 'mapbox' ? 'https://account.mapbox.com/access-tokens/' : 'https://console.cloud.google.com/google/maps-apis/credentials'
		},
		credentialLabel: type === 'mapbox' ? 'Mapbox public token (pk…)' : 'Google Maps browser API key'
	}));
}
const googleSetup =
	'Enable Maps JavaScript API and billing. Restrict a dedicated browser key to the current website origin and the required Google APIs. The SDK sends this browser key directly to Google. DEMO_MAP_ID is used for advanced markers; use your own map ID in your app. Each Run can incur provider charges.';
export const MAP_SDK_EXAMPLES: LibraryExample[] = [
	...sdk(
		'Mapbox',
		'mapbox',
		'https://docs.mapbox.com/mapbox-gl-js/examples/',
		[
			['Interactive street map', mapboxInput, `${mapboxStart}return {center:map.getCenter().toArray(),zoom:map.getZoom()};`],
			[
				'Marker and popup',
				{ ...mapboxInput, label: 'Melbourne' },
				`${mapboxStart}new mapboxgl.Marker().setLngLat([input.longitude,input.latitude]).setPopup(new mapboxgl.Popup().setText(String(input.label))).addTo(map).togglePopup();return {marker:[input.longitude,input.latitude],label:input.label};`
			],
			[
				'Fit multiple markers',
				{
					...mapboxInput,
					points: [
						[144.9631, -37.8136],
						[144.9691, -37.818],
						[144.9717, -37.8202]
					]
				},
				`${mapboxStart}const bounds=new mapboxgl.LngLatBounds();for(const point of input.points){new mapboxgl.Marker().setLngLat(point).addTo(map);bounds.extend(point)}map.fitBounds(bounds,{padding:50,maxZoom:15,duration:0});return {markers:input.points.length};`
			],
			[
				'GeoJSON route line',
				{
					...mapboxInput,
					points: [
						[144.9631, -37.8136],
						[144.9691, -37.818],
						[144.9717, -37.8202]
					]
				},
				`${mapboxStart}map.addSource('route',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:input.points}}});map.addLayer({id:'route',type:'line',source:'route',paint:{'line-color':'#6366f1','line-width':6}});return {vertices:input.points.length};`
			],
			[
				'GeoJSON area polygon',
				{
					...mapboxInput,
					points: [
						[144.96, -37.81],
						[144.97, -37.81],
						[144.97, -37.82],
						[144.96, -37.82],
						[144.96, -37.81]
					]
				},
				`${mapboxStart}map.addSource('area',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[input.points]}}});map.addLayer({id:'area',type:'fill',source:'area',paint:{'fill-color':'#6366f1','fill-opacity':0.45}});return {vertices:input.points.length};`
			]
		],
		'Use a public pk… token with the necessary map/style scopes, restricted to this website. Never enter a secret sk… token. Mapbox GL JS and its CSS load from the official CDN only after Run. Map loads may be billed.'
	),
	...sdk(
		'Google Maps',
		'google-maps',
		'https://developers.google.com/maps/documentation/javascript/examples',
		[
			['Interactive map', googleInput, `${googleStart}return {center:map.getCenter().toJSON(),zoom:map.getZoom()};`],
			[
				'Advanced marker',
				{ ...googleInput, label: 'Melbourne' },
				`${googleStart}const {AdvancedMarkerElement}=await google.maps.importLibrary('marker');new AdvancedMarkerElement({map,position:{lat:input.lat,lng:input.lng},title:String(input.label)});return {label:input.label};`
			],
			[
				'Marker information window',
				{ ...googleInput, label: 'Hello from Melbourne' },
				`${googleStart}const {AdvancedMarkerElement}=await google.maps.importLibrary('marker');const marker=new AdvancedMarkerElement({map,position:{lat:input.lat,lng:input.lng},title:String(input.label)});const content=document.createElement('div');content.textContent=String(input.label);const info=new google.maps.InfoWindow({content});marker.addListener('click',()=>info.open({map,anchor:marker}));info.open({map,anchor:marker});return {label:input.label};`
			],
			[
				'Polyline path',
				{
					...googleInput,
					points: [
						{ lat: -37.8136, lng: 144.9631 },
						{ lat: -37.818, lng: 144.9691 },
						{ lat: -37.8202, lng: 144.9717 }
					]
				},
				`${googleStart}new google.maps.Polyline({map,path:input.points,strokeColor:'#6366f1',strokeWeight:5});return {vertices:input.points.length};`
			],
			[
				'Radius circle',
				{ ...googleInput, radius: 700 },
				`${googleStart}new google.maps.Circle({map,center:{lat:input.lat,lng:input.lng},radius:input.radius,fillColor:'#6366f1',fillOpacity:0.3,strokeWeight:2});return {radiusMeters:input.radius};`
			]
		],
		googleSetup
	),
	...sdk(
		'Google Places',
		'google-maps',
		'https://developers.google.com/maps/documentation/javascript/place',
		[
			[
				'Text search map',
				{ query: 'cafes in Melbourne' },
				`const {Place}=await google.maps.importLibrary('places');const response=await Place.searchByText({textQuery:input.query,fields:${placeFields},maxResultCount:5});const places=response.places||[];${placePresentation}`
			],
			[
				'Nearby search map',
				{ lat: -37.8136, lng: 144.9631, radius: 500 },
				`const {Place}=await google.maps.importLibrary('places');const response=await Place.searchNearby({fields:${placeFields},locationRestriction:{center:{lat:input.lat,lng:input.lng},radius:input.radius},includedPrimaryTypes:['cafe'],maxResultCount:5});const places=response.places||[];${placePresentation}`
			],
			[
				'Place details map',
				{ placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' },
				`const {Place}=await google.maps.importLibrary('places');const place=new Place({id:input.placeId});await place.fetchFields({fields:${placeFields}});const places=[place];${placePresentation}`
			],
			[
				'Autocomplete and first place',
				{ query: 'Federation Square Melbourne' },
				`const {AutocompleteSuggestion,AutocompleteSessionToken}=await google.maps.importLibrary('places');const sessionToken=new AutocompleteSessionToken();const {suggestions}=await AutocompleteSuggestion.fetchAutocompleteSuggestions({input:input.query,sessionToken});const prediction=suggestions.find(s=>s.placePrediction)?.placePrediction;const places=[];if(prediction){const place=prediction.toPlace();await place.fetchFields({fields:${placeFields}});places.push(place)}${placePresentation}`,
				'Fetch predictions for the entered text, then resolve the first prediction in the same billing session. The result appears on a Google map; each Run starts a new session.'
			]
		],
		googleSetup + ' Also enable Places API (New) and permit it on the key. Only selected fields and at most five results are requested.'
	)
];
