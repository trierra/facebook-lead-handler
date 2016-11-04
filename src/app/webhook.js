'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
var sesTransport = require('nodemailer-ses-transport');

const log = require('winston');
log.level = 'debug';
log.add(log.transports.File, {filename: 'logfile.log'});

const nodemailer = require('nodemailer');
const configFile = '../config/config.json';

var configuration = JSON.parse(
    fs.readFileSync(configFile)
);

const formId = configuration.formId.id;

var access_token = 'EAAXxIatCqX4BADnexTUrPxb1c8VOgVau4Sx1buTL3aFDz0yewqHEPTHxiNtlleO5Ls5nG6UAXFnZAYMzN8aykqZAL6EqBMEbkLZBc9aAuxoGAKf0KuU6id2Tf8rUzwZC6DwKALeQ6seRtbtMH19VxNV3EALZBf5QMyqjZBPWsZBEgZDZD';

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
    log.log('Loaded lead ' + leadId );

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
                log.log('Lead details: id ' + leadId + ', email: ' + email + ' at ' + new Date());

                sendMail(email);
            }
        });
    }
});

/**
 * test
 */
app.get('/parse', function (req, resp) {

    loadLeadDetails('leadid', function (data) {
        if (data) {
            var email = '';
            for (var element in data.field_data) {
                if (data.field_data[element].name === 'email') {
                    email = data.field_data[element].values[0];
                }
            }
            log.log('Email from lead: ', email);
            sendMail(email);
        }
    });

});

/**
 * prod
 * @param leadId
 * @param callback
 */
function loadLeadDetails(leadId, callback) {
    log.warn('Loading details...');
    var url = buildUrl(leadId);

    console.log(url);

    var options = {
        url: url,
        encoding: 'utf-8'
    };

    request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            log.warn(body);
            var data = JSON.parse(body);
            if (data.error) {
                if (data.error.message.includes('Error validating access token')) {
                    log.warn('Session has expired, refreshing token on ' + new Date());
                    access_token = refreshToken();
                    loadLeadDetails(leadId, callback);
                } else {
                    log.warn(data.error.message);
                    console.log(data.error.message);
                }
            } else {
                callback(data)
            }
        }
    });
}

//TODO: finish
function refreshToken() {
 return 'EAAXxIatCqX4BAHYNtgOSKbPZAZCFpIZAuZC6fZCfcw1362DZCim1N6oFwUDQkjS9ZB2CS3F0jf6u1ZAsfugrxbQeNGb7OdMHj1IUZCyxV7c9GmDYncZA8BCmdLjXjqGGOiLkOq3hbxrmM09QuM1UEYsBaOcLpZANgnRGZAxZCaauU24ZCGuAZDZD';
}


//TODO: refactor
function buildUrl(leadId) {
    return 'https://graph.facebook.com/v2.8/' + leadId + '?access_token=' + access_token +
        '&format=json&method=get&pretty=0&suppress_http_code=1';
}

function sendMail(email) {
    log.log('sending mail to ' + email);
    log.warn('sending mail to ' + email);

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

// send mail with defined transport object
    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            return log.error(error);
        }
        log.log('Message sent: to ' + email + ' ' + info.response);
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
//http.createServer(app).listen(8000);
