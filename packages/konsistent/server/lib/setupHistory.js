/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * DS208: Avoid top-level this
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
/*
 * @TODO test sincrony
 */

this.Meta = {};
Konsistent = {};
Konsistent.MetaByCollection = {};
Konsistent.Models = {};
Konsistent.History = {};
Konsistent.References = {};
Konsistent.tailHandle = null;

const mongodbUri = Npm.require('mongodb-uri');

// Get db name from connection string
const uri = mongodbUri.parse(process.env.MONGO_URL);
const dbName = uri.database;
if (
	_.isEmpty(process.env.DISABLE_KONSISTENT) ||
	process.env.DISABLE_KONSISTENT === 'false' ||
	process.env.DISABLE_KONSISTENT === '0'
) {
	console.log(`[konsistent] === ${dbName} ===`.green);
}

// Define fome keys to remove from saved data in history when data was created or updated
const keysToIgnore = [
	'_updatedAt',
	'_createdAt',
	'_updatedBy',
	'_createdBy',
	'_deletedBy',
	'_deletedBy'
];

// Define collection Konsistent to save last state
Konsistent.Models.Konsistent = new Meteor.Collection('Konsistent');

const CursorDescription = function(collectionName, selector, options) {
	const self = this;
	self.collectionName = collectionName;
	self.selector = Mongo.Collection._rewriteSelector(selector);
	self.options = options || {};
	return self;
};

// Method to init data obervation of all collections with meta.saveHistory equals to true
Konsistent.History.setup = function() {
	if (
		(Konsistent.History != null ? Konsistent.History.db : undefined) != null
	) {
		if (Konsistent.tailHandle != null) {
			Konsistent.tailHandle.stop();
		}
		Konsistent.History.db.close();
	}

	// Get record that define last processed oplog
	const lastProcessedOplog = Konsistent.Models.Konsistent.findOne({
		_id: 'LastProcessedOplog'
	});

	const metaNames = [];

	for (let metaName in Meta) {
		const meta = Meta[metaName];
		metaNames.push(`${dbName}.${meta.collection}`);
	}

	// Create condition to get oplogs of update and insert types from data collections
	const queryData = {
		op: {
			$in: ['u', 'i']
		},
		ns: {
			$in: metaNames
		}
	};

	// Create condition to get oplogs of insert type from trash collections
	const queryTrash = {
		op: 'i',
		ns: {
			$in: metaNames.map(name => name + '.Trash')
		}
	};

	// Define query with data and trash conditions
	const query = { $or: [queryData, queryTrash] };

	// If there are some saved point add ts condition to get records after these point
	if (
		(lastProcessedOplog != null ? lastProcessedOplog.ts : undefined) != null
	) {
		query.ts = { $gt: lastProcessedOplog.ts };
	}

	// Connect in local collection and bind callback into meteor fibers
	// MongoInternals.NpmModule.MongoClient.connect process.env.MONGO_OPLOG_URL, Meteor.bindEnvironment (err, db) ->
	// 	if err then throw err

	Konsistent.History.db = new MongoInternals.Connection(
		process.env.MONGO_OPLOG_URL,
		{ poolSize: 1 }
	);

	// Get oplog native collection
	const collection = Konsistent.History.db.rawCollection('oplog.rs');

	// If there are no ts saved go to db to get last oplog registered
	if (query.ts == null) {
		// Turn findOne sync
		const findOne = Meteor.wrapAsync(_.bind(collection.findOne, collection));

		// find last oplog record and get only ts value
		const lastOplogTimestamp = findOne({}, { ts: 1 }, { sort: { ts: -1 } });

		// If there are return then add ts to oplog observer and save the ts into Konsistent collection
		if (
			(lastOplogTimestamp != null ? lastOplogTimestamp.ts : undefined) != null
		) {
			query.ts = { $gt: lastOplogTimestamp.ts };
			Konsistent.History.saveLastOplogTimestamp(lastOplogTimestamp.ts);
		}
	}

	const cursorDescription = new CursorDescription('oplog.rs', query, {
		tailable: true
	});

	return (Konsistent.tailHandle = Konsistent.History.db.tail(
		cursorDescription,
		Meteor.bindEnvironment(function(doc) {
			const ns = doc.ns.split('.');
			return Konsistent.History.processOplogItem(doc);
		})
	));
};

// # Define query as tailable to receive insertions
// options =
// 	tailable: true

// # Define a cursor with above query
// global.oplogStream = stream = collection.find(query, options).stream()

// stream.on 'error', Meteor.bindEnvironment (err) ->
// 	if err? then throw err

// stream.on 'data', Meteor.bindEnvironment (doc) ->
// 	if doc?
// 		ns = doc.ns.split '.'

// 		Konsistent.History.processOplogItem doc

// Process each result from tailable cursor bindind into Meteor's fibers
// cursor.each Meteor.bindEnvironment (err, doc) ->
// 	if err? then throw err
// 	if doc?
// 		ns = doc.ns.split '.'

// 		Konsistent.History.processOplogItem doc

// Process each oplog item to verify if there are data to save as history
Konsistent.History.processOplogItem = function(doc) {
	// Split ns into array to get db name, meta name and if is a trash collection
	let key, value;
	const ns = doc.ns.split('.');

	// Init detault data
	let { _id } = doc.o;
	let action = 'create';
	const data = doc.o;
	let metaName =
		Konsistent.MetaByCollection[ns[Math.min(2, ns.length - 1)]] ||
		Konsistent.MetaByCollection[`data.${ns[2]}`] ||
		Konsistent.MetaByCollection[ns.slice(1).join('.')];
	metaName = metaName.name;

	// If opration is an update get _id from o2 and define action as update
	if (doc.op === 'u') {
		({ _id } = doc.o2);
		action = 'update';
	}

	// If there are an property $set then move all fields to main object
	if (data.$set != null) {
		for (key in data.$set) {
			value = data.$set[key];
			data[key] = value;
		}
	}

	// If there are an property $unset then set fields as null on main object
	if (data.$unset != null) {
		for (key in data.$unset) {
			value = data.$unset[key];
			data[key] = null;
		}
	}

	// Remove properties $set and $unset that was already copied to main object
	delete data.$set;
	delete data.$unset;

	// Now all values are in main object then get _updatedAt and _updatedBy and set to another variables
	let updatedBy = data._updatedBy;
	let updatedAt = data._updatedAt;

	// If record is from a Trash collection set action as delete and use _deleteAt and By as _updatedAt and By
	if (ns[3] === 'Trash') {
		action = 'delete';
		updatedBy = data._deletedBy;
		updatedAt = data._deletedAt;
	}

	// Update relatinos if action was an update
	if (action === 'update') {
		Konsistent.History.updateLookupReferences(metaName, _id, data);
	}

	Konsistent.History.processReverseLookups(metaName, _id, data, action);

	// Update documents with relations to this document
	Konsistent.History.updateRelationReferences(metaName, action, _id, data);

	// Remove some internal data
	for (key of Array.from(keysToIgnore)) {
		delete data[key];
	}

	// Verify if meta of record was setted to save history
	if (
		(Meta[metaName] != null ? Meta[metaName].saveHistory : undefined) === true
	) {
		// Pass data and update information to create history record
		Konsistent.History.createHistory(
			metaName,
			action,
			_id,
			data,
			updatedBy,
			updatedAt,
			doc
		);
	}

	// Save last processed ts
	Konsistent.History.saveLastOplogTimestamp(doc.ts);

	return Konsistent.History.processAlertsForOplogItem(
		metaName,
		action,
		_id,
		data,
		updatedBy,
		updatedAt
	);
};

let saveLastOplogTimestampTimout = null;
let saveLastOplogTimestampQueueSize = 0;
const saveLastOplogTimestampSaveDelay = 100;
const saveLastOplogTimestampMaxQueueSize = 1000;
const saveLastOplogTimestampGreaterValue = null;

// Save last processed timestamp into Konsistent collection
Konsistent.History.saveLastOplogTimestamp = function(ts) {
	let saveLastOplogTimestampGratherValue;
	if (
		saveLastOplogTimestampGreaterValue == null ||
		ts.greaterThan(saveLastOplogTimestampGreaterValue)
	) {
		saveLastOplogTimestampGratherValue = ts;
	}

	const flush = function() {
		const query = { _id: 'LastProcessedOplog' };

		const data = {
			_id: 'LastProcessedOplog',
			ts: saveLastOplogTimestampGratherValue
		};

		const options = { upsert: true };

		try {
			return Konsistent.Models.Konsistent.update(query, data, options);
		} catch (e) {
			console.log(e);
			return NotifyErrors.notify(
				'SaveLastOplogTimestamp',
				e({
					query,
					data,
					options
				})
			);
		}
	};

	saveLastOplogTimestampQueueSize++;
	if (saveLastOplogTimestampTimout != null) {
		clearTimeout(saveLastOplogTimestampTimout);
	}

	const timeoutFn = function() {
		saveLastOplogTimestampQueueSize = 0;
		return flush();
	};

	saveLastOplogTimestampTimout = setTimeout(
		Meteor.bindEnvironment(timeoutFn),
		saveLastOplogTimestampSaveDelay
	);

	if (saveLastOplogTimestampQueueSize >= saveLastOplogTimestampMaxQueueSize) {
		clearTimeout(saveLastOplogTimestampTimout);
		saveLastOplogTimestampQueueSize = 0;
		return flush();
	}
};

// Method to create a new History using meta, action, old record and new record
Konsistent.History.createHistory = function(
	metaName,
	action,
	id,
	data,
	updatedBy,
	updatedAt,
	oplogDoc
) {
	// If data is empty or no update data is avaible then abort
	if (
		Object.keys(data).length === 0 ||
		updatedAt == null ||
		updatedBy == null ||
		data._merge != null
	) {
		return;
	}

	const historyData = {};

	const meta = Meta[metaName];

	// Remove fields that is marked to ignore history
	for (let key in data) {
		const value = data[key];
		const field = meta.fields[key];
		if ((field != null ? field.ignoreHistory : undefined) !== true) {
			historyData[key] = value;
		}
	}

	// Log operation to shell
	let log = metaName;

	switch (action) {
		case 'create':
			log = `+ ${log}`.green;
			break;
		case 'update':
			log = `• ${log}`.blue;
			break;
		case 'delete':
			log = `- ${log}`.red;
			break;
	}

	if (global.logAllRequests === true) {
		console.log(log);
	}

	// Get history collection
	const history = Konsistent.Models[`${metaName}.History`];

	// If can't get history collection terminate this method
	if (history == null) {
		return NotifyErrors.notify(
			'SaveLastOplogTimestamp',
			new Error(`Can't get History collection from ${metaName}`)
		);
	}

	const historyQuery = {
		_id: oplogDoc.ts.getHighBits() * 100000 + oplogDoc.ts.getLowBits()
	};

	// Define base data to history
	const historyItem = {
		_id: historyQuery._id,
		dataId: id,
		createdAt: updatedAt,
		createdBy: updatedBy,
		data: historyData,
		type: action
	};

	// Create history!
	try {
		return history.update(historyQuery, historyItem, { upsert: true });
	} catch (e) {
		console.log(e);
		return NotifyErrors.notify('createHistory', e, {
			historyQuery,
			historyItem,
			upsert: true
		});
	}
};

// Method to update reverse relations of one record
Konsistent.History.updateRelationReferences = function(
	metaName,
	action,
	id,
	data
) {
	// Get references from meta
	let relation, relations, relationsFromDocumentName;
	const references = Konsistent.References[metaName];

	// Verify if exists reverse relations
	if (
		!_.isObject(references) ||
		!_.isObject(references.relationsFrom) ||
		Object.keys(references.relationsFrom).length === 0
	) {
		return;
	}

	// Get model
	let model = Konsistent.Models[metaName];

	// If action is delete then get collection trash
	if (action === 'delete') {
		model = Konsistent.Models[`${metaName}.Trash`];
	}

	const referencesToUpdate = {};

	// If action is create or delete then update all records with data related in this record
	if (action !== 'update') {
		for (relationsFromDocumentName in references.relationsFrom) {
			relations = references.relationsFrom[relationsFromDocumentName];
			referencesToUpdate[relationsFromDocumentName] = relations;
		}
		// Else update only data when changes in this document affects related aggregation
	} else {
		// Get all keys that was updated
		const updatedKeys = Object.keys(data);

		// Iterate over all relations to verify if each relation has filter's terms or aggregate's fields in updatedKeys
		for (relationsFromDocumentName in references.relationsFrom) {
			relations = references.relationsFrom[relationsFromDocumentName];
			for (relation of Array.from(relations)) {
				let referencedKeys = [];

				if (_.isString(relation.lookup)) {
					referencedKeys.push(relation.lookup);
				}

				referencedKeys = referencedKeys.concat(
					utils.getFirstPartOfArrayOfPaths(
						utils.getTermsOfFilter(relation.filter)
					)
				);

				for (let fieldName in relation.aggregators) {
					const aggregator = relation.aggregators[fieldName];
					if (aggregator.field != null) {
						referencedKeys.push(aggregator.field.split('.')[0]);
					}
				}

				// Remove duplicated fields, can exists because we splited paths to get only first part
				referencedKeys = _.uniq(referencedKeys);
				// Get only keys that exists in references and list of updated keys
				referencedKeys = _.intersection(referencedKeys, updatedKeys);

				// If there are common fields, add relation to list of relations to be processed
				if (referencedKeys.length > 0) {
					if (referencesToUpdate[relationsFromDocumentName] == null) {
						referencesToUpdate[relationsFromDocumentName] = [];
					}
					referencesToUpdate[relationsFromDocumentName].push(relation);
				}
			}
		}
	}

	// If there are 0 references to process then abort
	if (Object.keys(referencesToUpdate).length === 0) {
		return;
	}

	// Find record with all information, not only udpated data, to calc aggregations
	const record = model.findOne({ _id: id });

	// If no record was found log error to console and abort
	if (record == null) {
		return NotifyErrors.notify(
			'updateRelationReferences',
			new Error(`Can't find record ${id} from ${metaName}`),
			{
				metaName,
				action,
				id,
				data,
				referencesToUpdate
			}
		);
	}

	// # Iterate over relations to process
	return (() => {
		const result = [];
		for (var referenceDocumentName in referencesToUpdate) {
			relations = referencesToUpdate[referenceDocumentName];
			result.push(
				(() => {
					const result1 = [];
					for (relation of Array.from(relations)) {
						var value;
						const relationLookupMeta = Meta[relation.document];
						// Get lookup id from record
						const lookupId = [];
						if (
							(record[relation.lookup] != null
								? record[relation.lookup]._id
								: undefined) != null
						) {
							lookupId.push(
								record[relation.lookup] != null
									? record[relation.lookup]._id
									: undefined
							);
						} else if (
							(relationLookupMeta.fields[relation.lookup] != null
								? relationLookupMeta.fields[relation.lookup].isList
								: undefined) === true &&
							_.isArray(record[relation.lookup])
						) {
							for (value of Array.from(record[relation.lookup])) {
								if ((value != null ? value._id : undefined) != null) {
									lookupId.push(value != null ? value._id : undefined);
								}
							}
						}

						// If action is update and the lookup field of relation was updated go to hitory to update old relation
						if (
							lookupId.length > 0 &&
							action === 'update' &&
							(data[relation.lookup] != null
								? data[relation.lookup]._id
								: undefined) != null
						) {
							// Try to get history model
							const historyModel = Konsistent.Models[`${metaName}.History`];

							if (historyModel == null) {
								NotifyErrors.notify(
									'updateRelationReferences',
									new Error(`Can't get model for document ${metaName}.History`)
								);
							}

							// Define query of history with data id
							const historyQuery = { dataId: id.toString() };

							// Add condition to get aonly data with changes on lookup field
							historyQuery[`data.${relation.lookup}`] = { $exists: true };

							// And sort DESC to get only last data
							const historyOptions = { sort: { createdAt: -1 } };

							// User findOne to get only one data
							const historyRecord = historyModel.findOne(
								historyQuery,
								historyOptions
							);

							// If there are record
							if (historyRecord != null) {
								// Then get lookupid to execute update on old relation
								let historyLookupId =
									historyRecord.data[relation.lookup] != null
										? historyRecord.data[relation.lookup]._id
										: undefined;
								if (
									(relationLookupMeta.fields[relation.lookup] != null
										? relationLookupMeta.fields[relation.lookup].isList
										: undefined) === true &&
									_.isArray(historyRecord.data[relation.lookup])
								) {
									historyLookupId = [];
									for (value of Array.from(
										historyRecord.data[relation.lookup]
									)) {
										historyLookupId.push(value != null ? value._id : undefined);
									}
								}

								// Execute update on old relation
								historyLookupId = [].concat(historyLookupId);
								for (let historyLookupIdItem of Array.from(historyLookupId)) {
									Konsistent.History.updateRelationReference(
										metaName,
										relation,
										historyLookupIdItem,
										action,
										referenceDocumentName
									);
								}
							}
						}

						// Execute update of relations into new value
						result1.push(
							Array.from(lookupId).map(lookupIdItem =>
								Konsistent.History.updateRelationReference(
									metaName,
									relation,
									lookupIdItem,
									action,
									referenceDocumentName
								)
							)
						);
					}
					return result1;
				})()
			);
		}
		return result;
	})();
};

// Method to udpate documents with references in this document
Konsistent.History.updateRelationReference = function(
	metaName,
	relation,
	lookupId,
	action,
	referenceDocumentName
) {
	// Try to get metadata
	let aggregator, e, query;
	const meta = Meta[metaName];

	if (meta == null) {
		return NotifyErrors.notify(
			'updateRelationReference',
			new Error(`Can't get meta of document ${metaName}`)
		);
	}

	if (_.isObject(relation)) {
		relation = JSON.parse(JSON.stringify(relation));
	}

	// Init a query with filter of relation
	if ((relation != null ? relation.filter : undefined) != null) {
		query = filterUtils.parseFilterObject(relation.filter, meta);
	}

	// If no query was setted, then init a empty filter
	if (query == null) {
		query = {};
	}
	// Add condition to get only documents with lookup to passaed lookupId
	query[`${relation.lookup}._id`] = lookupId;

	// Get data colletion from native mongodb
	const relationMeta = Meta[relation.document];
	const collection = Konsistent.Models[relation.document]._getCollection();

	// Init update object
	const valuesToUpdate = {
		$set: {},
		$unset: {}
	};

	// Iterate over all aggregators to create the update object
	for (var fieldName in relation.aggregators) {
		// Only allow aggregatores with some methods
		aggregator = relation.aggregators[fieldName];
		if (
			![
				'count',
				'sum',
				'min',
				'max',
				'avg',
				'first',
				'last',
				'addToSet'
			].includes(aggregator.aggregator)
		) {
			continue;
		}

		const pipeline = [];

		// Init query to aggregate data
		const match = { $match: query };

		pipeline.push(match);

		// Init aggregation object to aggregate all values into one
		const group = {
			$group: {
				_id: null,
				value: {}
			}
		};

		let type = '';

		// If agg is count then use a trick to count records using sum
		if (aggregator.aggregator === 'count') {
			group.$group.value.$sum = 1;
		} else {
			// Get type of aggrated field
			const aggregatorField =
				Meta[relation.document].fields[aggregator.field.split('.')[0]];
			({ type } = aggregatorField);

			// If type is money ensure that field has .value
			if (type === 'money' && !/\.value$/.test(aggregator.field)) {
				aggregator.field += '.value';
			}

			// And get first occurency of currency
			if (type === 'money') {
				group.$group.currency = {
					$first: `$${aggregator.field.replace('.value', '.currency')}`
				};
			}

			if (type === 'lookup' && aggregator.aggregator === 'addToSet') {
				if (aggregatorField.isList === true) {
					pipeline.push({ $unwind: `$${aggregator.field}` });
				}

				const addToSetGroup = {
					$group: {
						_id: `$${aggregator.field}._id`,
						value: {
							$first: `$${aggregator.field}`
						}
					}
				};

				pipeline.push(addToSetGroup);

				aggregator.field = 'value';
			}

			// If agg inst count then use agg method over passed agg field
			group.$group.value[`$${aggregator.aggregator}`] = `$${aggregator.field}`;
		}

		pipeline.push(group);

		// Wrap aggregate method into an async metero's method
		const aggregate = Meteor.wrapAsync(
			_.bind(collection.aggregate, collection)
		);

		// Try to execute agg and log error if fails
		try {
			const result = aggregate(pipeline);
			// If result was an array with one item cotaining a property value
			if (
				_.isArray(result) &&
				_.isObject(result[0]) &&
				result[0].value != null
			) {
				// If aggregator is of type money create an object with value and currency
				if (type === 'money') {
					valuesToUpdate.$set[fieldName] = {
						currency: result[0].currency,
						value: result[0].value
					};
				} else {
					// Then add value to update object
					valuesToUpdate.$set[fieldName] = result[0].value;
				}
			} else {
				// Else unset value
				valuesToUpdate.$unset[fieldName] = 1;
			}
		} catch (error) {
			e = error;
			NotifyErrors.notify('updateRelationReference', e, {
				pipeline
			});
		}
	}

	// Remove $set if empty
	if (Object.keys(valuesToUpdate.$set).length === 0) {
		delete valuesToUpdate.$set;
	}

	// Remove $unset if empty
	if (Object.keys(valuesToUpdate.$unset).length === 0) {
		delete valuesToUpdate.$unset;
	}

	// If no value was defined to set or unset then abort
	if (Object.keys(valuesToUpdate).length === 0) {
		return;
	}

	// Try to get reference model
	const referenceModel = Konsistent.Models[referenceDocumentName];
	if (referenceModel == null) {
		return NotifyErrors.notify(
			'updateRelationReference',
			new Error(`Can't get model for document ${referenceDocumentName}`)
		);
	}

	// Define a query to udpate records with aggregated values
	const updateQuery = { _id: lookupId };

	// Try to execute update query
	try {
		const affected = referenceModel.update(updateQuery, valuesToUpdate);

		// If there are affected records
		if (affected > 0) {
			// Log Status
			console.log(
				`∑ ${referenceDocumentName} < ${metaName} (${affected})`.yellow
			);
			// And log all aggregatores for this status
			for (fieldName in relation.aggregators) {
				aggregator = relation.aggregators[fieldName];
				if (aggregator.field != null) {
					console.log(
						`  ${referenceDocumentName}.${fieldName} < ${
							aggregator.aggregator
						} ${metaName}.${aggregator.field}`.yellow
					);
				} else {
					console.log(
						`  ${referenceDocumentName}.${fieldName} < ${
							aggregator.aggregator
						} ${metaName}`.yellow
					);
				}
			}
		}

		return affected;
	} catch (error1) {
		e = error1;
		return NotifyErrors.notify('updateRelationReference', e, {
			updateQuery,
			valuesToUpdate
		});
	}
};

// Method to update reverse relations of one record
Konsistent.History.updateLookupReferences = function(metaName, id, data) {
	// Get references from meta
	let field, fieldName, fields;
	const references = Konsistent.References[metaName];

	// Verify if exists reverse relations
	if (
		!_.isObject(references) ||
		!_.isObject(references.from) ||
		Object.keys(references.from).length === 0
	) {
		return;
	}

	// Get model
	const model = Konsistent.Models[metaName];

	// Define object to receive only references that have reference fields in changed data
	const referencesToUpdate = {};

	// Get all keys that was updated
	const updatedKeys = Object.keys(data);

	// Iterate over all relations to verify if each relation have fields in changed keys
	for (var referenceDocumentName in references.from) {
		fields = references.from[referenceDocumentName];
		for (fieldName in fields) {
			var key;
			field = fields[fieldName];
			let keysToUpdate = [];
			// Split each key to get only first key of array of paths
			if (
				(field.descriptionFields != null
					? field.descriptionFields.length
					: undefined) > 0
			) {
				for (key of Array.from(field.descriptionFields)) {
					keysToUpdate.push(key.split('.')[0]);
				}
			}

			if (
				(field.inheritedFields != null
					? field.inheritedFields.length
					: undefined) > 0
			) {
				for (key of Array.from(field.inheritedFields)) {
					keysToUpdate.push(key.fieldName.split('.')[0]);
				}
			}

			// Remove duplicated fields, can exists because we splited paths to get only first part
			keysToUpdate = _.uniq(keysToUpdate);
			// Get only keys that exists in references and list of updated keys
			keysToUpdate = _.intersection(keysToUpdate, updatedKeys);

			// If there are common fields, add field to list of relations to be processed
			if (keysToUpdate.length > 0) {
				if (referencesToUpdate[referenceDocumentName] == null) {
					referencesToUpdate[referenceDocumentName] = {};
				}
				referencesToUpdate[referenceDocumentName][fieldName] = field;
			}
		}
	}

	// If there are 0 relations to process then abort
	if (Object.keys(referencesToUpdate).length === 0) {
		return;
	}

	// Find record with all information, not only udpated data, to can copy all related fields
	const record = model.findOne({ _id: id });

	// If no record was found log error to console and abort
	if (record == null) {
		return NotifyErrors.notify(
			'updateLookupReferences',
			new Error(`Can't find record ${id} from ${metaName}`)
		);
	}

	// Iterate over relations to process and iterate over each related field to execute a method to update relations
	return (() => {
		const result = [];
		for (referenceDocumentName in referencesToUpdate) {
			fields = referencesToUpdate[referenceDocumentName];
			result.push(
				(() => {
					const result1 = [];
					for (fieldName in fields) {
						field = fields[fieldName];
						result1.push(
							Konsistent.History.updateLookupReference(
								referenceDocumentName,
								fieldName,
								field,
								record,
								metaName
							)
						);
					}
					return result1;
				})()
			);
		}
		return result;
	})();
};

// Method to update a single field of a single relation from a single updated record
Konsistent.History.updateLookupReference = function(
	metaName,
	fieldName,
	field,
	record,
	relatedMetaName
) {
	// Try to get related meta
	const meta = Meta[metaName];
	if (meta == null) {
		return NotifyErrors.notify(
			'updateLookupReference',
			new Error(`Meta ${metaName} does not exists`)
		);
	}

	// Try to get related model
	const model = Konsistent.Models[metaName];
	if (model == null) {
		return NotifyErrors.notify(
			'updateLookupReference',
			new Error(`Model ${metaName} does not exists`)
		);
	}

	// Define field to query and field to update
	const fieldToQuery = `${fieldName}._id`;
	let fieldToUpdate = fieldName;

	// If field is isList then use .$ into field to update
	// to find in arrays and update only one item from array
	if (field.isList === true) {
		fieldToUpdate = `${fieldName}.$`;
	}

	// Define query with record id
	const query = {};
	query[fieldToQuery] = record._id;

	// Define an update of multiple records
	const options = { multi: true };

	// Init object of data to set
	const updateData = { $set: {} };

	// Add dynamic field name to update into object to update
	updateData.$set[fieldToUpdate] = {};

	// If there are description fields
	if (
		_.isArray(field.descriptionFields) &&
		field.descriptionFields.length > 0
	) {
		// Execute method to copy fields and values using an array of paths
		utils.copyObjectFieldsByPathsIncludingIds(
			record,
			updateData.$set[fieldToUpdate],
			field.descriptionFields
		);
	}

	// If there are inherit fields
	if (_.isArray(field.inheritedFields) && field.inheritedFields.length > 0) {
		// For each inherited field
		for (var inheritedField of Array.from(field.inheritedFields)) {
			if (['always', 'hierarchy_always'].includes(inheritedField.inherit)) {
				// Get field meta
				var inheritedMetaField = meta.fields[inheritedField.fieldName];

				if (inheritedField.inherit === 'hierarchy_always') {
					// If inherited field not is a lookup our not is list then notify to bugsnag and ignore process
					if (
						(inheritedMetaField != null
							? inheritedMetaField.type
							: undefined) !== 'lookup' ||
						inheritedMetaField.isList !== true
					) {
						NotifyErrors.notify(
							'updateLookupReference[hierarchy_always]',
							new Error('Not lookup or not isList'),
							{
								inheritedMetaField,
								query,
								updateData,
								options
							}
						);
						continue;
					}
					if (record[inheritedField.fieldName] == null) {
						record[inheritedField.fieldName] = [];
					}
					record[inheritedField.fieldName].push({
						_id: record._id
					});
				}

				// If field is lookup
				if (
					(inheritedMetaField != null ? inheritedMetaField.type : undefined) ===
					'lookup'
				) {
					// Get model to find record
					const lookupModel = Konsistent.Models[inheritedMetaField.document];

					if (lookupModel == null) {
						console.log(
							new Error(`Document ${inheritedMetaField.document} not found`)
						);
						continue;
					}

					if (
						(record[inheritedField.fieldName] != null
							? record[inheritedField.fieldName]._id
							: undefined) != null ||
						(inheritedMetaField.isList === true &&
							(record[inheritedField.fieldName] != null
								? record[inheritedField.fieldName].length
								: undefined) > 0)
					) {
						var lookupRecord, subQuery;
						if (inheritedMetaField.isList !== true) {
							subQuery = {
								_id: record[inheritedField.fieldName]._id.valueOf()
							};

							// Find records
							lookupRecord = lookupModel.findOne(subQuery);

							// If no record found log error
							if (lookupRecord == null) {
								console.log(
									new Error(
										`Record not found for field ${
											inheritedField.fieldName
										} with _id [${subQuery._id}] on document [${
											inheritedMetaField.document
										}] not found`
									)
								);
								continue;
							}

							// Else copy description fields
							if (_.isArray(inheritedMetaField.descriptionFields)) {
								if (updateData.$set[inheritedField.fieldName] == null) {
									updateData.$set[inheritedField.fieldName] = {};
								}
								utils.copyObjectFieldsByPathsIncludingIds(
									lookupRecord,
									updateData.$set[inheritedField.fieldName],
									inheritedMetaField.descriptionFields
								);
							}

							// End copy inherited values
							if (_.isArray(inheritedMetaField.inheritedFields)) {
								for (let inheritedMetaFieldItem of Array.from(
									inheritedMetaField.inheritedFields
								)) {
									if (inheritedMetaFieldItem.inherit === 'always') {
										updateData.$set[inheritedMetaFieldItem.fieldName] =
											lookupRecord[inheritedMetaFieldItem.fieldName];
									}
								}
							}
						} else if (
							(record[inheritedField.fieldName] != null
								? record[inheritedField.fieldName].length
								: undefined) > 0
						) {
							let ids = record[inheritedField.fieldName].map(item => item._id);
							ids = _.compact(_.uniq(ids));
							subQuery = {
								_id: {
									$in: ids
								}
							};

							const subOptions = {};
							if (_.isArray(inheritedMetaField.descriptionFields)) {
								subOptions.fields = utils.convertStringOfFieldsSeparatedByCommaIntoObjectToFind(
									utils
										.getFirstPartOfArrayOfPaths(
											inheritedMetaField.descriptionFields
										)
										.join(',')
								);
							}

							// Find records
							const lookupRecords = lookupModel
								.find(subQuery, subOptions)
								.fetch();
							var lookupRecordsById = {};
							for (let item of Array.from(lookupRecords)) {
								lookupRecordsById[item._id] = item;
							}

							record[inheritedField.fieldName].forEach(function(item) {
								lookupRecord = lookupRecordsById[item._id];

								// If no record found log error
								if (lookupRecord == null) {
									console.log(
										new Error(
											`Record not found for field ${
												inheritedField.fieldName
											} with _id [${item._id}] on document [${
												inheritedMetaField.document
											}] not found`
										)
									);
									return;
								}

								// Else copy description fields
								if (_.isArray(inheritedMetaField.descriptionFields)) {
									const tempValue = {};
									utils.copyObjectFieldsByPathsIncludingIds(
										lookupRecord,
										tempValue,
										inheritedMetaField.descriptionFields
									);
									if (updateData.$set[inheritedField.fieldName] == null) {
										updateData.$set[inheritedField.fieldName] = [];
									}
									return updateData.$set[inheritedField.fieldName].push(
										tempValue
									);
								}
							});
						}
					}
				} else {
					// Copy data into object to update if inherit method is 'always'
					updateData.$set[inheritedField.fieldName] =
						record[inheritedField.fieldName];
				}
			}
		}
	}

	try {
		// Execute update and get affected records
		const affectedRecordsCount = model.update(query, updateData, options);

		// If there are affected records then log into console
		if (affectedRecordsCount > 0) {
			console.log(
				`∞ ${relatedMetaName} > ${metaName}.${fieldName} (${affectedRecordsCount})`
					.yellow
			);
		}

		return affectedRecordsCount;
	} catch (e) {
		// Log if update get some error
		return NotifyErrors.notify('updateLookupReference', e, {
			query,
			updateData,
			options
		});
	}
};

// Method to update reverse relations of one record
Konsistent.History.processReverseLookups = function(
	metaName,
	id,
	data,
	action
) {
	let field;
	if (action === 'delete') {
		return;
	}

	const meta = Meta[metaName];
	const model = Konsistent.Models[metaName];

	let reverseLookupCount = 0;
	for (var fieldName in meta.fields) {
		field = meta.fields[fieldName];
		if (
			field.type === 'lookup' &&
			field.reverseLookup != null &&
			data[field.name] !== undefined
		) {
			reverseLookupCount++;
		}
	}

	if (reverseLookupCount === 0) {
		return;
	}

	// Get all data to copty into lookups
	const query = { _id: id };

	const record = model.findOne(query);

	if (record == null) {
		return NotifyErrors.notify(
			'ReverseLoockup Error',
			new Error(
				`Record not found with _id [${id.valueOf()}] on document [${metaName}]`
			)
		);
	}

	// Process reverse lookups
	return (() => {
		const result = [];
		for (fieldName in meta.fields) {
			field = meta.fields[fieldName];
			if (field.type === 'lookup' && field.reverseLookup != null) {
				var affectedRecordsCount, reverseLookupQuery, reverseLookupUpdate;

				const reverseLookupMeta = Meta[field.document];

				if (reverseLookupMeta == null) {
					NotifyErrors.notify(
						'ReverseLoockup Error',
						new Error(`Meta [${field.document}] not found`)
					);
					continue;
				}

				if (reverseLookupMeta.fields[field.reverseLookup] == null) {
					NotifyErrors.notify(
						'ReverseLoockup Error',
						new Error(
							`Field [${field.reverseLookup}] does not exists in [${
								field.document
							}]`
						)
					);
					continue;
				}

				const reverseLookupModel = Konsistent.Models[field.document];

				// Mount query and update to remove reverse lookup from another records
				if (data[field.name] !== undefined) {
					reverseLookupQuery = {};

					if (data[field.name] != null) {
						reverseLookupQuery._id = { $ne: data[field.name]._id };
					}

					reverseLookupQuery[`${field.reverseLookup}._id`] = id;

					reverseLookupUpdate = { $unset: {} };
					reverseLookupUpdate.$unset[field.reverseLookup] = 1;

					if (reverseLookupMeta.fields[field.reverseLookup].isList === true) {
						delete reverseLookupUpdate.$unset;
						reverseLookupUpdate.$pull = {};
						reverseLookupUpdate.$pull[`${field.reverseLookup}`] = { _id: id };
					}

					const options = { multi: true };

					affectedRecordsCount = reverseLookupModel.update(
						reverseLookupQuery,
						reverseLookupUpdate,
						options
					);

					if (affectedRecordsCount > 0) {
						console.log(
							`∞ ${field.document}.${
								field.reverseLookup
							} - ${metaName} (${affectedRecordsCount})`.yellow
						);
					}
				}

				// Create fake empty record to be populated with lookup detail fields and inherited fields
				if (data[field.name] != null) {
					const value = {};
					value[field.reverseLookup] = { _id: id };

					lookupUtils.copyDescriptionAndInheritedFields(
						reverseLookupMeta.fields[field.reverseLookup],
						value[field.reverseLookup],
						record,
						reverseLookupMeta,
						action,
						reverseLookupModel,
						value,
						value,
						[data[field.name]._id]
					);

					// Mount query and update to create the reverse lookup
					reverseLookupQuery = { _id: data[field.name]._id };

					reverseLookupUpdate = { $set: value };

					// If reverse lookup is list then add lookup to array and set inherited fields
					if (reverseLookupMeta.fields[field.reverseLookup].isList === true) {
						reverseLookupUpdate.$push = {};
						reverseLookupUpdate.$push[field.reverseLookup] =
							reverseLookupUpdate.$set[field.reverseLookup];
						delete reverseLookupUpdate.$set[field.reverseLookup];
						if (Object.keys(reverseLookupUpdate.$set).length === 0) {
							delete reverseLookupUpdate.$set;
						}
					}

					affectedRecordsCount = reverseLookupModel.update(
						reverseLookupQuery,
						reverseLookupUpdate
					);

					if (affectedRecordsCount > 0) {
						result.push(
							console.log(
								`∞ ${field.document}.${
									field.reverseLookup
								} < ${metaName} (${affectedRecordsCount})`.yellow
							)
						);
					} else {
						result.push(undefined);
					}
				} else {
					result.push(undefined);
				}
			}
		}
		return result;
	})();
};

Konsistent.History.processAlertsForOplogItem = function(
	metaName,
	action,
	_id,
	data,
	updatedBy,
	updatedAt
) {
	let field, userRecords, value;
	if (updatedBy == null) {
		return;
	}

	if (updatedAt == null) {
		return;
	}

	if (data._merge != null) {
		return;
	}

	const meta = Meta[metaName];

	if (meta == null) {
		return NotifyErrors.notify(
			'processAlertsForOplogItem',
			new Error(`Can't get meta for ${metaName}`)
		);
	}

	if (meta.sendAlerts !== true) {
		return;
	}

	const model = Konsistent.Models[metaName];

	if (model == null) {
		return NotifyErrors.notify(
			'processAlertsForOplogItem',
			new Error(`Can't get model for ${metaName}`)
		);
	}

	const userModel = Konsistent.Models['User'];

	if (userModel == null) {
		return NotifyErrors.notify(
			'processAlertsForOplogItem',
			new Error("Can't get model for User")
		);
	}

	let { code } = data;
	const usersToFindEmail = [];
	let users = [];
	if (data._user != null) {
		users = users.concat(data._user);
	}

	if (action === 'update') {
		const query = { _id };

		const options = {
			fields: {
				_user: 1,
				code: 1
			}
		};

		const updatedRecord = model.findOne(query, options);
		({ code } = updatedRecord);
		if (updatedRecord._user != null) {
			users = users.concat(updatedRecord._user);
		}
	}

	for (var user of Array.from(users)) {
		if (user != null && user._id !== updatedBy._id) {
			usersToFindEmail.push(user._id);
		}
	}

	if (usersToFindEmail.length === 0) {
		return;
	}

	const userQuery = {
		_id: {
			$in: usersToFindEmail
		},
		active: true
	};

	const userOptions = {
		fields: {
			username: 1,
			emails: 1,
			locale: 1
		}
	};

	try {
		userRecords = userModel.find(userQuery, userOptions).fetch();
	} catch (e) {
		NotifyErrors.notify('updateLookupReference', e, {
			userQuery,
			userOptions
		});
	}

	let actionText = 'Apagado';
	switch (action) {
		case 'create':
			actionText = 'Criado';
			break;
		case 'update':
			actionText = 'Alterado';
			break;
	}

	const excludeKeys = [
		'_updatedAt',
		'_updatedBy',
		'_createdAt',
		'_createdBy',
		'_deletedAt',
		'_deletedBy'
	];

	// Ignore fields that is marked to ignore history
	for (var key in data) {
		value = data[key];
		field = meta.fields[key];
		if ((field != null ? field.ignoreHistory : undefined) === true) {
			excludeKeys.push(key);
		}
	}

	return (() => {
		const result = [];
		for (user of Array.from(userRecords)) {
			const rawData = {};
			const dataArray = [];

			for (key in data) {
				value = data[key];
				if (!Array.from(excludeKeys).includes(key)) {
					if (key === '_id') {
						value = value;
					}

					field = key.split('.')[0];
					field = meta.fields[field];

					rawData[key] = value;

					if (field != null) {
						dataArray.push({
							field: utils.getLabel(field, user) || key,
							value: utils.formatValue(value, field)
						});
					} else {
						dataArray.push({
							field: utils.getLabel(field, user) || key,
							value
						});
					}
				}
			}

			if ((dataArray != null ? dataArray.length : undefined) === 0) {
				continue;
			}

			const documentName = utils.getLabel(meta, user) || meta.name;

			var alertData = {
				documentName,
				action,
				actionText,
				code,
				_id,
				_updatedBy: updatedBy,
				_updatedAt: updatedAt,
				data: dataArray,
				rawData,
				user
			};

			if (
				(Namespace.RocketChat != null
					? Namespace.RocketChat.alertWebhook
					: undefined) != null
			) {
				var urls = [].concat(Namespace.RocketChat.alertWebhook);
				result.push(
					(() => {
						const result1 = [];
						for (var url of Array.from(urls)) {
							if (!_.isEmpty(url)) {
								result1.push(
									HTTP.post(url, { data: alertData }, function(err, response) {
										if (err != null) {
											NotifyErrors.notify('HookRocketChatAlertError', err);
											return console.log(
												'📠 ',
												`Rocket.Chat Alert ERROR ${url}`.red,
												err
											);
										}

										if (response.statusCode === 200) {
											return console.log(
												'📠 ',
												`${response.statusCode} Rocket.Chat Alert ${url}`.green
											);
										} else {
											return console.log(
												'📠 ',
												`${response.statusCode} Rocket.Chat Alert ${url}`.red
											);
										}
									})
								);
							}
						}
						return result1;
					})()
				);
			} else if (
				__guard__(
					user.emails != null ? user.emails[0] : undefined,
					x => x.address
				) != null
			) {
				const emailData = {
					from: 'Konecty Alerts <alerts@konecty.com>',
					to: __guard__(
						user.emails != null ? user.emails[0] : undefined,
						x1 => x1.address
					),
					subject: `[Konecty] Dado em: ${documentName} com code: ${code} foi ${actionText}`,
					template: 'alert.html',
					data: alertData,
					type: 'Email',
					status: 'Send',
					discard: true
				};

				result.push(Konsistent.Models['Message'].insert(emailData));
			} else {
				result.push(undefined);
			}
		}
		return result;
	})();
};

function __guard__(value, transform) {
	return typeof value !== 'undefined' && value !== null
		? transform(value)
		: undefined;
}
