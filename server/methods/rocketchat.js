import http from 'request';
import qs from 'querystring';
import _ from 'lodash';
import moment from 'moment';

const getDepartments = function(fnCallback){
    http(confRequest('GET', Namespace.RocketChat.host + '/api/v1/livechat/department'), function(e, r, body){
        var data = qs.parse(body);
        fnCallback(data.departments);
    });
}

const confRequest = async function(method, url, data){
    const user = Meteor.user();
    const today = moment().seconds(0).minutes(0).hour(0).valueOf();
    const token = _.find(user.services.resume.loginTokens, function(token){
        return moment(token.when).valueOf() >= today;
    });

    let login = undefined;
    try {
        login = await http({
            url: Namespace.RocketChat.host + "/api/v1/login",
            method: "POST",
            data: {"user": namespace.RocketChat.username, "password": namespace.RocketChat.password},
            json:true
        });
    }catch(e){
        console.log('[ROCKET.CHAT INTEGRATION] error login in rocket ' + JSON.stringify(e));        
    }

    return _.merge({
        method: method,
        headers: {
            'X-Auth-Token': login.data.authToken,
            'X-User-Id': login.data.userId
        },
        url: url
    }, data !== undefined ? {
        body: data,
        json: true
    } : {});

}

const syncAgents = function(queue, department){
    const user = Meteor.users.findOne(Namespace.RocketChat.userIdCreateDepartaments);
    _.forEach(department.agents, function(agent){
        let userAgent = Models.user.findOne(agent._id);
        if (userAgent !== undefined){
            console.log('[ROCKET.CHAT INTEGRATION] insert agent ' + queue.name + ' for queue ' + department._id + ' in QueueUsers');
            Models.QueueUsers.insert({
                count: agent.count,
                order:agent.order,
                queue:{
                    _id: queue._id,
                    name: queue.name
                },
                type: ["Chat"],
                status: true,
                user: userAgent,
                _user: user,
                _createdAt: new Date(),
                _createdBy:  {
                    _id: user._id,
                    name: user.name,
                    group: user.group
                },
                _updatedAt: new Date(),
                _updatedBy:  {
                    _id: user._id,
                    name: user.name,
                    group: user.group
                }
            });
        }
    });
}

/**
 *
 *  
 **/ 
Meteor.methods({
    syncRocketChatDepartmentAndAgents: function(){
        const queues = Models.Queue.findAll({ type: { "$in": ["Chat"] }});
        const user = Meteor.users.findOne(Namespace.RocketChat.userIdCreateDepartaments);
        getDepartments(function(departments){
            _.forEach(departments, function(d){
                const queue = _.find(queues, function(q){
                    return d.name === q.name
                });

                if (queue === undefined) {
                    console.log('[ROCKET.CHAT INTEGRATION] insert queue ' + q.name + ' for department _id ' + d._id);
                    Models.Queue.insert({
                        _user: user,
                        active: d.enabled,
                        currentPosition:1,
                        rocketchat_id: d._id,
                        name: d.name,
                        _createdAt: new Date(),
                        _createdBy:  {
                            _id: user._id,
                            name: user.name,
                            group: user.group
                        },
                        _updatedAt: new Date(),
                        _updatedBy:  {
                            _id: user._id,
                            name: user.name,
                            group: user.group
                        }
                    }, function(error, queue_id){
                        syncAgents({
                            _id:queue_id,
                            name: queue.name
                        }, d)
                    });

                }else if (queue.rocketchat_id === undefined) {
                    console.log('[ROCKET.CHAT INTEGRATION] update queue ' + queue.name + ' with department _id ' + d._id);
                    Models.Queue(queue._id, { $set: { rocketchat_id: d._id } });
                    syncAgents(queue, d);
                }                
            });
        });
    },
    createRocketChatDepartment: function(queue){
        const department = {
            "enabled": queue.active, 
            "name": queue.name,
            "description": _.get(queue, 'description', '')
        };
        console.log('[ROCKET.CHAT INTEGRATION] trying to create department '+ queue.name);
        http(confRequest('POST', Namespace.RocketChat.host + '/api/v1/livechat/department', department), function(e, r, body){
            const data = qs.parse(body);
            if (data.success){
                console.log('[ROCKET.CHAT INTEGRATION] new department '+ data.name);
                console.log('[ROCKET.CHAT INTEGRATION] update queue ' + queue.name + ' with department _id ' + data._id);
                Models.Queue(queue._id, { $set: { rocketchat_id: data.department._id } });
            }else{
                console.log('[ROCKET.CHAT INTEGRATION] Error '+JSON.stringify(data));
                console.log('[ROCKET.CHAT INTEGRATION] Error '+JSON.stringify(e));
                console.log('[ROCKET.CHAT INTEGRATION] Error '+JSON.stringify(r));
            }
        });
    },
    updateRocketChatDepartment: function(queue, department_id){
        const department = {
            "enabled": queue.active,
            "name": queue.name,
            "description": _.get(queue, 'description', '')
        };
        console.log('[ROCKET.CHAT INTEGRATION] trying to update department '+ queue.name);
        http(confRequest('PUT',Namespace.RocketChat.host + '/api/v1/livechat/department/'+department_id, queue), function(e, r, body){
            const data = qs.parse(body);
            if (data.success){
                console.log('[ROCKET.CHAT INTEGRATION] update department '+ data.name);
            }else{
                console.log('[ROCKET.CHAT INTEGRATION] Error ' + JSON.stringify(data));
            }
        });
    },
    removeRocketChatDepartment: function( department_id ){
        console.log('[ROCKET.CHAT INTEGRATION] trying to remove department '+ data.name);
        http(confRequest('DELETE', Namespace.RocketChat.host + '/api/v1/livechat/department/'+department_id) , function(e, r, body){
            const data = qs.parse(body);
            if (data.success){
                console.log('[ROCKET.CHAT INTEGRATION] remove department '+ data.name);
            }else{
                console.log('[ROCKET.CHAT INTEGRATION] Error '+JSON.stringify(data));
            }
        });
    },
    syncRocketChatAgents: function(queue_id){
        const user = Meteor.users.findOne(Namespace.RocketChat.userIdCreateDepartaments);
        const queue = Meteor.Queue.findOne(queue_id);
        const queueUsers = Meteor.QueueUsers({ "queue._id" : queue_id });
        const agents = _.map(queueUsers, function(queueUser){
            return {
                "agentId": queueUser.user._id,
                "username": queueUser.user.name,
                "count": queueUser.count,
                "order": queueUser.order
            };
        });
        if (agents.length === 0){
            console.log('[ROCKET.CHAT INTEGRATION] unknow error on update agents in department '+ queue.name);
        }else{
            console.log('[ROCKET.CHAT INTEGRATION] trying to update agents in department '+ queue.name);
            http(confRequest('PUT', Namespace.RocketChat.host + '/api/v1/livechat/department/'+queue.rocketchat_id, { "agents": agents}), function(e, r, body){
                const data = qs.parse(body);
                if (data.success){
                    console.log('[ROCKET.CHAT INTEGRATION] update department '+ data.name);
                }else{
                    console.log('[ROCKET.CHAT INTEGRATION] Error ' + JSON.stringify(data));
                }
            });
        }
    }
});