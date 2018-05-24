/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * DS208: Avoid top-level this
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
this.Namespace = {};

const rebuildReferences = function() {
	Konsistent.History.setup();

	console.log('[konsistent] Rebuilding references');
	return Konsistent.References = buildReferences(Meta);
};

const registerMeta = function(meta) {
	if (meta.collection == null) { meta.collection = `data.${meta.name}`; }
	Meta[meta.name] = meta;
	Konsistent.MetaByCollection[meta.collection] = meta;

	if (!Konsistent.Models[meta.name]) {
		Konsistent.Models[`${meta.name}.History`] = Konsistent._Models[`${meta.name}.History`] || new Meteor.Collection(`${meta.collection}.History`);
		Konsistent.Models[`${meta.name}.Trash`] = Konsistent._Models[`${meta.name}.Trash`] || new Meteor.Collection(`${meta.collection}.Trash`);
		Konsistent.Models[`${meta.name}.Comment`] = Konsistent._Models[`${meta.name}.Comment`] || new Meteor.Collection(`${meta.collection}.Comment`);
		Konsistent.Models[`${meta.name}.AutoNumber`] = Konsistent._Models[`${meta.name}.AutoNumber`] || new Meteor.Collection(`${meta.collection}.AutoNumber`);

		switch (meta.collection) {
			case 'users':
				return Konsistent.Models[meta.name] = Meteor.users;
			default:
				return Konsistent.Models[meta.name] = Konsistent._Models[meta.name] || new Meteor.Collection(meta.collection);
		}
	}
};


const deregisterMeta = function(meta) {
	delete Meta[meta.name];

	delete Konsistent.Models[`${meta.name}.History`];
	delete Konsistent.Models[`${meta.name}.Trash`];
	delete Konsistent.Models[`${meta.name}.Comment`];
	delete Konsistent.Models[`${meta.name}.AutoNumber`];
	return delete Konsistent.Models[meta.name];
};


const registerTemplate = function(record) {
	Templates[record._id] = {
		template: SSR.compileTemplate(record._id, record.value),
		subject: record.subject
	};

	return (() => {
		const result = [];
		for (let name in record.helpers) {
			let fn = record.helpers[name];
			const helper = {};
			fn = [].concat(fn);
			helper[name] = Function.apply(null, fn);
			result.push(Template[record._id].helpers(helper));
		}
		return result;
	})();
};

Konsistent.start = function(MetaObject, Models, rebuildMetas) {
	if (rebuildMetas == null) { rebuildMetas = true; }
	Konsistent.MetaObject = MetaObject;
	Konsistent._Models = Models || {};

	UserPresenceMonitor.setVisitorStatus = function(id, status) {
		if ((Konsistent._Models.ChatVisitor == null)) { Konsistent._Models.ChatVisitor = new Meteor.Collection("data.ChatVisitor"); }
		return Konsistent._Models.ChatVisitor.update({_id: id, userStatus: {$ne: status}}, {$set: {userStatus: status}});
	};

	UserPresenceMonitor.start();

	const MetaObjectQuery =
		{type: 'document'};

	Meteor.publish("konsistent/metaObject", function() {
		if (this.userId == null) { return this.ready(); }

		return Konsistent.MetaObject.find(MetaObjectQuery);
	});

	if (Konsistent._Models.Template != null) {
		Konsistent._Models.Template.find({type: 'email'}).observe({
			added(record) {
				return registerTemplate(record);
			},

			changed(record) {
				return registerTemplate(record);
			},

			removed(record) {
				return delete Templates[record._id];
			}});
	}

	Konsistent.MetaObject.find({type: 'namespace'}).observe({
		added(meta) {
			console.log('add meta ->', meta);

			return global.Namespace = meta;
		},

		changed(meta) {
			return global.Namespace = meta;
		}
	});

	if (rebuildMetas) {
		let rebuildReferencesTimer = null;
		const rebuildReferencesDelay = 100;
		Konsistent.MetaObject.find(MetaObjectQuery).observe({
			added(meta) {
				registerMeta(meta);

				clearTimeout(rebuildReferencesTimer);
				return rebuildReferencesTimer = setTimeout(Meteor.bindEnvironment(rebuildReferences), rebuildReferencesDelay);
			},

			changed(meta) {
				registerMeta(meta);

				clearTimeout(rebuildReferencesTimer);
				return rebuildReferencesTimer = setTimeout(Meteor.bindEnvironment(rebuildReferences), rebuildReferencesDelay);
			},

			removed(meta) {
				deregisterMeta(meta);

				clearTimeout(rebuildReferencesTimer);
				return rebuildReferencesTimer = setTimeout(Meteor.bindEnvironment(rebuildReferences), rebuildReferencesDelay);
			}
		});

		return mailConsumer.start();
	}
};
