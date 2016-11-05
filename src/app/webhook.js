'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const nodemailer = require('nodemailer');
var sesTransport = require('nodemailer-ses-transport');
const log = require('winston');

log.level = 'debug';
log.add(log.transports.File, {filename: 'logfile.log'});

const configFile = '../config/config.json';

var configuration = JSON.parse(
    fs.readFileSync(configFile)
);

var longToken = configuration.longToken;

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());


// for Facebook verification
/**@prod*/
app.get('/webhook/', function (req, res) {
    if (req.query['hub.verify_token'] === configuration.webhookVerification) {
        res.send(req.query['hub.challenge'])
    } else {
        res.send('Error, wrong token')
    }
});


/**@prod, catches ping leads*/
app.post('/webhook/', function (req, res) {

    var leadId = req.body.entry[0].changes[0].value.leadgen_id;
    log.info('Loaded lead ' + leadId);

    if (leadId) {
        loadLeadDetails(leadId, function (data) {
            if (data) {
                var email = '';
                for (var i in data.field_data) {
                    if (data.field_data[i].name === 'email') {
                        email = data.field_data[i].values[0];
                        break;
                    }
                }
                log.info('Lead details: id ' + leadId + ', email: ' + email + ' at ' + new Date().getTime());

                sendMail(email);
            }
        });
    }
});

/**
 * test
 */
app.get('/parse', function (req, res) {
    loadLeadDetails('leadid', function (data) {
        if (data) {
            var email = '';
            for (var element in data.field_data) {
                if (data.field_data[element].name === 'email') {
                    email = data.field_data[element].values[0];
                }
            }
            log.info('Email from lead: ', email);
            sendMail(email);
        }
    });
});

app.post('/callback/', function (req, res) {
    var token = req.body.access_token;
    log.info('Getting long-lived token at ' + new Date().getTime());

    //TODO: move to separate function
    var uri = 'https://graph.facebook.com/v2.8/oauth/access_token?grant_type=fb_exchange_token&client_id=' + configuration.fbAuth.clientId
        + '&client_secret=' + configuration.fbAuth.secret + '&fb_exchange_token=' + token;

    var options = {
        url: uri
    };

    request(options, function (error, response, body) {
        if (!error && response.status == 200) {
            log.warn('Long-term access token retrieved: ' + body + ' at ' + new Date().getTime());
        }
    })
});

/**
 * prod
 * @param leadId
 * @param callback
 */
function loadLeadDetails(leadId, callback) {
    log.info('Loading details... for ' + leadId);
    var url = buildUrl(leadId);

    var options = {
        url: url,
        encoding: 'utf-8'
    };

    request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var data = JSON.parse(body);
            if (data.error) {
                if (data.error.message.includes('Error validating access token')) {
                    log.warn('Session has expired, refreshing token on ' + new Date().getTime());

                    var mailOptions = {
                        from: configuration.smtp.service,
                        to: configuration.smtp.admin, //temporary for test mode
                        subject: 'Session has expired',
                        text: 'Error token at ' + new Date().getTime() + configuration.tokenErrorMail
                    };

                    sendMail(configuration.smtp.admin, mailOptions);

                } else {
                    log.error(data.error.message);
                }
            } else {
                callback(data)
            }
        }
    });
}


//TODO: refactor
function buildUrl(leadId) {
    return 'https://graph.facebook.com/v2.8/' + leadId + '?access_token=' + longToken +
        '&format=json&method=get&pretty=0&suppress_http_code=1';
}

function sendMail(email, options) {
    log.info('sending mail to ' + email);

    var transporter = nodemailer.createTransport(sesTransport({
        accessKeyId: configuration.smtp.accessKey,
        secretAccessKey: configuration.smtp.secret,
        rateLimit: 5, // do not send more than 5 messages in a second
        region: configuration.smtp.region,
        host: configuration.smtp.host
    }));

    var mailOptions = {
        from: configuration.smtp.sender,
        to: configuration.smtp.sender, //temporary for test mode
        subject: 'New lead',
        text: 'With email ' + email
    };

    if (!options) {
        options = mailOptions;
    }

// send mail with defined transport object
    transporter.sendMail(options, function (error, info) {
        if (error) {
            return log.error(error);
        }
        log.info('Message sent: to ' + email + ' ' + info.response);
    });
}

/**@prod*/
app.get('/platform', function (req, res) {
    res.sendFile(path.resolve('../view/platform.html'));
});


var options = {
    key: fs.readFileSync('/etc/letsencrypt/live/willingbot.online/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/willingbot.online/fullchain.pem')
};
https.createServer(options, app).listen(8443);

//uncomment for localhost
// http.createServer(app).listen(8000);
