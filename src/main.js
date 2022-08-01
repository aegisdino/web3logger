import express from 'express';
import bodyParser from 'body-parser';

require('./util.js');

const configpath = __dirname + '/../src/config/';
const configfile = configpath + 'server-config.json';

const fs = require('fs');
const cookieParser = require('cookie-parser');
var serverconfig = read_serverconfig();

var app = express();
const helmet = require('helmet')

var session = require('express-session');

app.use('/', express.static(__dirname + "/../public"));
app.use(helmet());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
if (serverconfig.HTTPS)
  app.set('trust proxy', true);
var cors = require('cors');
var corsOptions = {
  origin: '*',
  credentials: true
};
app.use(cors(corsOptions));
app.use(session({
  name: 'sessionID',
  secret: 'gogo andromeda',
  resave: true,
  saveUninitialized: false,
  cookie: {
    maxAge: 60 * 60 * 1000,
    httpOnly: !serverconfig.HTTPS,
    secure: serverconfig.HTTPS
  }
}));
app.disable('x-powered-by');
app.serverconfig = serverconfig;

const router = require('./webrouter.js');
app.use('/api/v1/', router);

router.startServer(app);

app.listen(serverconfig.WEBPORT, () => {
  console.log('App running on http://*:' + serverconfig.WEBPORT);
})

function read_serverconfig(oldconfig) {
  var data = fs.readFileSync(configfile, 'utf8');
  try {
    var newconfig = JSON.parse(data);
    if (oldconfig == undefined || JSON.stringify(oldconfig) != JSON.stringify(newconfig)) {
      return newconfig;
    }
    else {
      console.log('serverconfig', 'value not changed');
    }
  }
  catch (err) {
    console.log('serverconfig', 'parse failed', err);
  }
  return null;
}

fs.watchFile(configfile, { encoding: 'utf-8' }, (curr, prev) => {
  if (curr.mtime != prev.mtime) {
    var config = read_serverconfig(app.serverconfig);
    if (config) {
      update_image_path();
      app.serverconfig = config;
      console.log('serverconfig', 'config changed', app.serverconfig);
    }
  }
});
