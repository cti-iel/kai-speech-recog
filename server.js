// Set up Express
const express = require('express');
const app = express();
//const port = 3000;
const port = 443;
//const wsport = 13000
const fs = require('fs');
const WebSocket = require('ws');
const axios = require('axios');
const marked = require('marked');
const https = require('https');
const FormData = require('form-data');
const multer  = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const { Readable } =  require('stream');
const { Blob } = require("buffer");
const wavDecoder = require("wav-decoder");

const hostname = '0.0.0.0'

const openaiApiKey = process.env.OPENAI_API_KEY;
const customXApiKey = process.env.XAPI_KEY;     // GL Custom LLM API

// Sleep Timer
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// HTTPS
const server = require('https').createServer({
    key: fs.readFileSync('./ssl/privatekey.pem'),
    cert: fs.readFileSync('./ssl/cert.pem'),
}, app);

// Enable EJS
app.set("view engine","ejs");

app.use(express.static('link'));

// Ignore SSL using axios
const axiosMod = axios.create({
	httpsAgent: new https.Agent( {rejectUnauthorized: false })
});

// Top
app.get('/', (req, res) => {
  res.render('chat.ejs');
});

// Send prompt to API and get response
app.get('/send_prompt', async (req, res) => {
	
  const prompt = req.query.prompt;
  var answer = '(Tentative Ans) I am KAI';
  
  //Post API here
  // OpenAI API
  /*
  const data = {
	model: "gpt-3.5-turbo",
	messages: [{"role": "user", "content": prompt}],
	temperature: 0.7,
  };

  const config = {
  headers: {
		'Authorization': `Bearer ${openaiApiKey}`,
		'Content-Type': 'application/json'
	},
  };
  */
  
  // Custom API
  const data = {
	messages: [{"role": "user", "content": prompt}],
	temperature: 0.7,
  };

  const config = {
  headers: {
		'X-API-KEY': `${customXApiKey}`,
		'Content-Type': 'application/json'
	},
  };
  
  const headers = {
	'X-API-KEY': `${customXApiKey}`,
	'Content-Type': 'application/json'
  };
  
  let retries = 3;
  let jobId;
  
  while (retries > 0) {
	try {
		let res0 = await axios.post('https://hgmd-p2-1-dev.hitachirail.com/api/chat', data, config);
	
		if (res0.status === 200) {
			jobId = res0.data['job_id']
			console.log(`Chat Job ID: ${jobId}`);
			break;
			
		} else {
			console.log(`Received status code ${res0.status}. Retrying...`);
		}
		
	} catch (error) {
		console.log(`Error: ${error.message}. Retrying...`);
	}
	retries--;
  }
  
  // Request Error
  if (retries <= 0) {
	  console.log('Error creating a chatbot instance:');
	  res.status(500).send(JSON.stringify({ message: 'Error creating a chatbot instance' }));
  }
  
  // Wait until the API is ready (>1500 msec)
  let tried = 0;
  while(true) {
	await sleep(3000);
	  try {
		response = await axios.get(`https://hgmd-p2-1-dev.hitachirail.com/api/chat/${jobId}`, config);
		if (response.status === 200 && response.data !== "") {
		  //console.log(typeof response.data);
		  answer = response.data.choices[0].message.content;
		  break;
		  
		} else {
			tried++;
			console.log(`Received status code ${response.status}. Retrying... ${tried}`);
		}
	  } catch (error) {
		  console.log(`Error: ${error.message}`);
		  res.status(500).send(JSON.stringify({ message: 'Error receiving a response from the chatbot' }));
	  }
  }
  
  console.log(`Answer: ${answer}`);
  
  // Remove file info
  const optans = answer.replace(/\[.*?\]/g, '').trim();
  
  // Text to Speech
  const data2 = {
	model: "tts-1",
	input: optans,
	voice: "alloy",
  };
  const config2 = {
	headers: {
		'Authorization': `Bearer ${openaiApiKey}`,
	},
	responseType: 'arraybuffer', 
  };
  
  // Send request
  retries = 3;
  let b64buf;
  while (retries > 0) {
	try {
	  response2 = await axios.post('https://api.openai.com/v1/audio/speech', data2, config2);
	  if (response2.data !== "") {
		b64buf = Buffer.from(response2.data).toString('base64');
		break;
	  }
	  if (response2.status === 200) {
		// Skip
	  } else {
		  console.log(`Received status code ${response2.status}. Retrying...`);
	  }
	} catch (error) {
	  console.log(`Error: ${error.message}. Retrying...`);
	}
	retries--;
  }
  
  // Request Error
  if (retries <= 0) {
	  console.log('Error generating speech file:');
	  res.status(500).send(JSON.stringify({ message: 'Error generating speech file' }));
  }

  const speechData = {
	  data: b64buf,
	  type: 'audio/mpeg'
  }
  
  //sendData  = `Question: ${prompt}: <br> ${answer}`;
  sendData  = answer;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ response: sendData, speech: speechData }));
});



// Buffer to Stream for Audio file handling
const  bufferToStream  = (buffer) => { 
	return  Readable.from(buffer);
};

// Calculate RMS from buffer
const calculateRMS = (channelData) => {
  // Calculate RMS for each channel and average them
  let totalRMS = 0;
  channelData.forEach(channel => {
    const meanSquare = channel.reduce((acc, val) => acc + val * val, 0) / channel.length;
    totalRMS += Math.sqrt(meanSquare);
  });
  return totalRMS / channelData.length; // Average RMS over all channels
};

// Calculate dB from buffer
const convertToDb = (rms) => {
  // Assuming 1.0 is the max amplitude for PCM data
  return 20 * Math.log10(rms / 1.0);
};

// OpenAI proxy
app.post('/proxy', upload.single('file'), async (req, res) => {

  if (req.file) {
	  console.log('Received file with filename:', req.file.originalname);
	  
	  // Check the wav file has voice data
	  try {
		const audioData = await wavDecoder.decode(req.file.buffer);
		const rms = calculateRMS(audioData.channelData);
		const db = convertToDb(rms);
		console.log(`Volume: ${db.toFixed(2)} dB`);
		
		// db must be configured
		// WAV file is valid, send it to whisper
		if (db > -40.0) {
			
			const  audioStream  =  bufferToStream(req.file.buffer);
			const formData = new FormData();
			formData.append('file', audioStream, { filename: req.file.originalname, contentType: req.file.mimetype });
			formData.append('model', 'whisper-1')
			
			const config = {
				headers: {
					...formData.getHeaders(),
					'Authorization': `Bearer ${openaiApiKey}`,
					'Content-Type': 'multipart/form-data'
				},
			};
			
			try {
				// Send to whisper
				let retries = 3;
				let response;
				while (retries > 0) {
					
					response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, config);
					
					if (response.status === 200) {
						// Response
						console.log(response.data);						
						// Send Responsed text
						res.status(200).send(JSON.stringify({ message: response.data.text, volume: db }));
						break;
						
					} else {
						console.log(`Received status code ${response.status}. Retrying...`);
					}
					retries--;
				}
			// Request Error
			} catch (error) {
				console.error('Error sending file to OpenAI:', error);
				res.status(500).send(JSON.stringify({ message: 'Error sending file to OpenAI' }));
			}
	  
		// WAV file is invalid
		} else {
			// Send back with no text
			res.status(200).send(JSON.stringify({ message: '', volume: db }));
		}

	  } catch (error) {
		  console.error("Error processing WAV file:", error);
	  }
	  
  } else {
	  res.status(400).send(JSON.stringify({ message: 'No file received' }));
  }
});


server.listen(port, () => {
  console.log(`HTTP Server listening at https://${hostname}:${port}`);
  console.log(`WebSocket Server listening at wss://${hostname}:${port}`);
});

// Set up Web socket
const wss = new WebSocket.Server({ server: server });

wss.on('connection', function connection(ws) {
	ws.on('message', function incoming(message) {
		console.log('received: %s', message);
		
		msgJSON = JSON.parse(message)
		
		var prompt = msgJSON['prompt'];
		
		console.log(prompt);
		
		// Execute prompt
		const params = `prompt=${prompt}`;
		axiosMod.get(`https://127.0.0.1:${port}/send_prompt?${params}`)
			.then((response) => {
				//console.log('Status:', response.status);
				//console.log('Data:', response.data);
				const sendData = {
					// The response must be MarkDown
					response: marked.parse(response.data['response']), // Change to HTML
					//response: response.data['response']
					speech: response.data['speech']
				};
				ws.send(JSON.stringify(sendData));
		
			}).catch((error) => {
				console.error('Error:', error);
		});
		
	});
});
