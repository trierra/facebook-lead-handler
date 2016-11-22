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
var MongoClient = require('mongodb').MongoClient
    , assert = require('assert');
var database = '';

log.level = 'debug';
log.add(log.transports.File, {filename: 'logfile.log'});

const configFile = '../config/config.json';

const mailTemplate = 'mail.html';

var template = fs.readFileSync(mailTemplate);


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
    log.info('New lead ' + leadId);

    var leadDetails = {
        email: '',
        phoneNumber: '',
        city: '',
        fullName: '',
        createdTime: '',
        id: '',
        emailSent: false
    };

    loadLeadDetails(leadId, function (data) {
            if (data) {

                leadDetails.createdTime = data.created_time;
                leadDetails.id = data.id;

                for (var element in data.field_data) {
                    log.info(data.field_data[element]);
                    switch (data.field_data[element].name) {
                        case 'email':
                            leadDetails.email = data.field_data[element].values[0];
                            break;
                        case 'phone_number':
                            leadDetails.phoneNumber = data.field_data[element].values[0];
                            break;
                        case 'full_name':
                            leadDetails.fullName = data.field_data[element].values[0];
                            break;
                        case 'city':
                            leadDetails.city = data.field_data[element].values[0];
                            break;
                        default:
                            log.warn('New data element in lead:' + data.field_data[element].name);
                    }
                }
                log.info(leadDetails);
                insertLeads(database, leadDetails, function (result) {
                    if (result) {
                        sendMail(leadDetails.email, null, function (data) {
                            log.info(data + '. Updating lead info...');
                            updateLead(database, leadDetails, function () {
                                log.info('Lead updatet for: ' + leadDetails.email);
                            })
                        });
                    }
                });
            }
        }
    );
});

/**
 * test
 */
app.get('/parse', function (req, res) {

    var leadDetails = {
        email: '',
        phoneNumber: '',
        city: '',
        fullName: '',
        createdTime: '',
        id: '',
        emailSent: false
    };

    loadLeadDetails('219459831816684', function (data) {
            if (data) {
                leadDetails.createdTime = data.created_time;
                leadDetails.id = data.id;

                for (var element in data.field_data) {
                    log.info(data.field_data[element]);
                    switch (data.field_data[element].name) {
                        case 'email':
                            leadDetails.email = data.field_data[element].values[0];
                            break;
                        case 'phone_number':
                            leadDetails.phoneNumber = data.field_data[element].values[0];
                            break;
                        case 'full_name':
                            leadDetails.fullName = data.field_data[element].values[0];
                            break;
                        case 'city':
                            leadDetails.city = data.field_data[element].values[0];
                            break;
                        default:
                            log.warn('New data element in lead:' + data.field_data[element].name);
                    }
                }
                log.info(leadDetails);
                insertLeads(database, leadDetails, function (result) {
                    if (result) {
                        sendMail(leadDetails.email, null, function (data) {
                            log.info(data + '. Updating lead info...');
                            updateLead(database, leadDetails, function () {
                                log.info('Lead updatet for: ' + leadDetails.email);
                            })
                        });
                    }
                });
            }
        }
    );
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
                if (data.error.message.includes('Error validating access token') || data.error.message.includes('Invalid OAuth access token')) {
                    log.warn('Session has expired, refreshing token on ' + new Date().getTime());

                    var mailOptions = {
                        from: configuration.smtp.service,
                        to: configuration.smtp.admin, //temporary for test mode
                        subject: 'Session has expired',
                        text: 'Error token at ' + new Date().getTime() + configuration.tokenErrorMail
                    };

                    sendMail(configuration.smtp.admin, mailOptions, function (data) {
                        log.info(data);
                    });

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

function sendMail(email, options, callback) {

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
        to: email, 
        bcc: [configuration.smtp.bcc, configuration.smtp.bcc2],
        subject: configuration.smtp.subject,
        html: template
    };

    if (!options) {
        options = mailOptions;
    }

// send mail with defined transport object
    transporter.sendMail(options, function (error, info) {
        if (error) {
            log.error(error);
        } else {
            callback('Message sent: to ' + email);
        }
    });
}

/**@prod Required to subscribe fo page RTUs */
app.get('/platform', function (req, res) {
    res.sendFile(path.resolve('../view/platform.html'));
});

var insertLeads = function (db, data, callback) {
    var collection = db.collection('leads');
    collection.findOne({'email': data.email}, function (err, lead) {
        assert.equal(err, null);
        if (lead) {
            log.info(data.id + ' Lead exists ' + lead.email);
            callback(null)
        } else {
            collection.insert(data, function (err, result) {
                assert.equal(err, null);
                log.info('Lead inserted into document');
                callback(result);
            })
        }
    })
};

var updateLead = function (db, data, callback) {
    var collection = db.collection('leads');
    log.info('updating ', data.id);
    collection.update({'id': data.id}, {$set: {'emailSent': true}}, function () {
        callback('Lead \'' + data.email + '\' updated')
    });
};

// Connection URL
var mongoUrl = configuration.mongodb;

// Use connect method to connect to the server
MongoClient.connect(mongoUrl, function (err, db) {

    assert.equal(null, err);
    log.info("Connected successfully to mongodb server");
    database = db;

    var options = {
        key: fs.readFileSync('/etc/letsencrypt/live/willingbot.online/privkey.pem'),
        cert: fs.readFileSync('/etc/letsencrypt/live/willingbot.online/fullchain.pem')
    };
    https.createServer(options, app).listen(8443);

//uncomment for localhost
//     http.createServer(app).listen(8000);
});



