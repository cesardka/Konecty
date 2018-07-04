import http from 'request';
import qs from 'querystring';

let requestOptions = {
    headers: {
        'X-Auth-Token': null,
        'X-User-Id': null
    }
};

const createDepartment = function(data){
    const department = {
        "enabled": data.active,
        "showOnRegistration": true,
        "name": data.name,
        "description": ""
    };
    
    requestOptions.url = Namespace.RocketChat.host + '/api/v1/livechat/department';
    
    console.log('[ROCKET.CHAT INTEGRATION] trying to create department '+ data.name).green();
    http.post(requestOptions, function(e, r, body){
        const data = qs.parse(body);
        if (data.success){
            console.log('[ROCKET.CHAT INTEGRATION] new department '+ data.name).green();
        }else{
            console.log('[ROCKET.CHAT INTEGRATION] Error '+JSON.stringify(data)).red();
        }
    });
};
const  updateDepartment = function(data, department_id){
    const department = {
        "enabled": data.active,
        "showOnRegistration": true,
        "name": data.name,
        "description": ""
    };

    requestOptions.url = Namespace.RocketChat.host + '/api/v1/livechat/department/'+department_id;

    console.log('[ROCKET.CHAT INTEGRATION] trying to update department '+ data.name).green();
    http.put(requestOptions, function(e, r, body){
        const data = qs.parse(body);
        if (data.success){
            console.log('[ROCKET.CHAT INTEGRATION] update department '+ data.name).green();
        }else{
            console.log('[ROCKET.CHAT INTEGRATION] Error '+JSON.stringify(data)).red();
        }
    });
};

const removeDepartment = function( department_id ){
    requestOptions.url = Namespace.RocketChat.host + '/api/v1/livechat/department/'+department_id;

    console.log('[ROCKET.CHAT INTEGRATION] trying to remove department '+ data.name).green();
    http.delete(requestOptions, function(e, r, body){
        const data = qs.parse(body);
        if (data.success){
            console.log('[ROCKET.CHAT INTEGRATION] remove department '+ data.name).green();
        }else{
            console.log('[ROCKET.CHAT INTEGRATION] Error '+JSON.stringify(data)).red();
        }
    });
};

const  getDepartments = function(){
    requestOptions.url = Namespace.RocketChat.host + '/api/v1/livechat/department';

    http.get(requestOptions, function(e, r, body){
        var data = qs.parse(body);
        callback(data);
    });
}


/**
 *
 *  
 **/ 
Meteor.methods({
    syncDepartment: function(queue, queueUsers){
        var user = Meteor.user();
        requestOptions.headers = {
            'X-Auth-Token': user.services.password.bcrypt,
            'X-User-Id': user._id
        };

        
    }
});