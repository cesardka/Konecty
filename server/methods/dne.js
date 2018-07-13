/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const connection = {};

const getUtilDb = function() {
	const Mongodb = MongoInternals.NpmModule;
	const { MongoClient } = Mongodb;
	const { Server } = Mongodb;

	// let host = process.env.MONGO_URL.replace('mongodb://', '');
	// const hostPort = host
	// 	.split('/')
	// 	.shift()
	// 	.split(':');

	// host = hostPort[0];
	// const port = hostPort[1] || 27017;

	var mongoClient = new MongoClient(process.env.MONGO_URL, {
		auto_reconnect: true,
		poolSize: 2
	});

	mongoClient.connect((err, mongoClient) => {
		connection.db = mongoClient.db('utils');
		mongoClient.close();
	});

	// const server = new Server(host, port, { auto_reconnect: true, poolSize: 2 });

	// const db_connection = new Db('utils', server, { w: 0, native_parser: false });

	// return db_connection.open((err, db) => (connection.db = db));
};

getUtilDb();

const accentToRegex = function(str) {
	str = str.toLowerCase();

	str = str.replace('a', '[aàáâãäåæ]');
	str = str.replace('c', '[cç]');
	str = str.replace('d', '[DÐ]');
	str = str.replace('e', '[eèéêëẽ]');
	str = str.replace('i', '[iìíîïĩ]');
	str = str.replace('o', '[oœðñòóôõöø]');
	str = str.replace('u', '[uµùúûü]');
	str = str.replace('s', '[sšß]');
	str = str.replace('z', '[zž]');
	str = str.replace('y', '[yýÿY¥]');
	return str;
};

Meteor.methods({
	DNE_CEP_List(cep) {
		const placeCollection = connection.db.collection('utils.address.BRA.place');

		let query = { postalCode: cep };

		let options = {
			fields: {
				_id: 0,
				startNeighbourhood: 1,
				postalCode: 1,
				place: 1,
				placeType: 1,
				init: 1,
				end: 1,
				city: 1,
				state: 1
			},
			sort: {
				country: 1,
				state: 1,
				city: 1,
				district: 1,
				place: 1,
				number: 1,
				complement: 1,
				postalCode: 1,
				placeType: 1
			}
		};

		let find = placeCollection.find(query, options);

		let toArray = Meteor.wrapAsync(find.toArray, find);

		let results = toArray();

		if (results.length) {
			for (let result of Array.from(results)) {
				result.district = result.startNeighbourhood;
				delete result.startNeighbourhood;
			}

			return results;

			// If results are not found on places collection, look for them on city collection
		} else {
			const cityCollection = connection.db.collection('utils.address.BRA.city');

			query = { postalCode: cep };

			options = {
				fields: {
					_id: 0,
					postalCode: 1,
					city: 1,
					state: 1
				},
				sort: {
					state: 1,
					city: 1,
					postalCode: 1
				}
			};

			find = cityCollection.find(query, options);

			toArray = Meteor.wrapAsync(find.toArray, find);

			results = toArray();
			return results;
		}
	},

	DNE_City_List(state, city) {
		const cityCollection = connection.db.collection('utils.address.BRA.city');

		const query = { state };

		if (city !== '*') {
			query.city = new RegExp(accentToRegex(city), 'i');
		}

		const options = {
			fields: {
				_id: 0,
				postalCode: 1,
				city: 1,
				state: 1
			},
			sort: {
				city: 1
			}
		};

		const find = cityCollection.find(query, options);

		const toArray = Meteor.wrapAsync(find.toArray, find);

		let results = toArray();

		results = utils.unicodeSortArrayOfObjectsByParam(results, 'city');

		return results;
	},

	DNE_District_List(state, city, district) {
		const districtCollection = connection.db.collection(
			'utils.address.BRA.district'
		);

		let query = { state };

		if (district !== '*') {
			query.district = new RegExp(accentToRegex(district), 'i');
		}

		if (city !== '*') {
			query.city = city;
		}

		const options = {
			fields: {
				_id: 0,
				district: 1,
				postalCode: 1,
				city: 1,
				state: 1
			},
			sort: {
				district: 1
			}
		};

		const find = districtCollection.find(query, options);

		const toArray = Meteor.wrapAsync(find.toArray, find);

		let results = toArray();

		// Get local ditricts
		if (Models['AddressPlace'] != null) {
			const districts = [];
			for (let result of Array.from(results)) {
				districts.push(result.district);
			}

			query = { state };

			if (city !== '*') {
				query.city = city;
			}

			if (district !== '*') {
				query.$and = [
					{ startNeighbourhood: new RegExp(accentToRegex(district), 'i') },
					{ startNeighbourhood: { $nin: districts } }
				];
			} else {
				query.startNeighbourhood = { $nin: districts };
			}

			const match = { $match: query };

			const group = {
				$group: {
					_id: {
						city: '$city',
						state: '$state',
						startNeighbourhood: '$startNeighbourhood'
					},
					district: {
						$first: '$startNeighbourhood'
					},
					postalCode: {
						$first: '$postalCode'
					},
					city: {
						$first: '$city'
					},
					state: {
						$first: '$state'
					}
				}
			};

			const project = {
				$project: {
					_id: 0,
					district: 1,
					postalCode: 1,
					placeType: 1,
					city: 1,
					state: 1
				}
			};

			const sort = {
				$sort: {
					place: 1
				}
			};

			const pipeline = [match, group, project, sort];

			const localResults = Models['AddressPlace'].aggregate(pipeline);

			if ((localResults != null ? localResults.length : undefined) > 0) {
				results = results.concat(localResults);
			}
		}

		// Sort and return results
		results = utils.unicodeSortArrayOfObjectsByParam(results, 'district');

		return results;
	},

	DNE_Place_List(state, city, district, place, number, limit) {
		const placeCollection = connection.db.collection('utils.address.BRA.place');

		const query = {
			state,
			city
		};

		if (district !== '*') {
			query.startNeighbourhood = district;
		}

		if (place !== '*') {
			query.place = new RegExp(accentToRegex(place), 'i');
		}

		if (number != null && number !== '*' && /^\d+$/.test(number)) {
			number = parseInt(number);

			query['$and'] = [
				{ $or: [{ init: { $exists: 0 } }, { init: { $lte: number } }] },
				{ $or: [{ end: { $exists: 0 } }, { end: { $gte: number } }] }
			];

			if (number % 2 === 0) {
				query.even = true;
			} else {
				query.odd = true;
			}
		}

		const match = { $match: query };

		const group = {
			$group: {
				_id: {
					city: '$city',
					state: '$state',
					place: '$place'
				},
				district: {
					$first: '$startNeighbourhood'
				},
				postalCode: {
					$addToSet: '$postalCode'
				},
				placeType: {
					$first: '$placeType'
				},
				init: {
					$min: '$init'
				},
				end: {
					$max: '$end'
				},
				city: {
					$first: '$city'
				},
				state: {
					$first: '$state'
				},
				place: {
					$first: '$place'
				}
			}
		};

		const project = {
			$project: {
				_id: 0,
				district: 1,
				postalCode: 1,
				placeType: 1,
				init: 1,
				end: 1,
				city: 1,
				state: 1,
				place: 1
			}
		};

		const sort = {
			$sort: {
				place: 1
			}
		};

		const pipeline = [match, group, project, sort];

		if (limit != null) {
			if (_.isString(limit) && /^l:[1-9]\d*$/.test(limit)) {
				pipeline.push({ $limit: parseInt(limit.split(':').pop()) });
			} else if (_.isNumber(limit)) {
				pipeline.push({ $limit: limit });
			}
		}

		const aggregate = Meteor.wrapAsync(
			placeCollection.aggregate,
			placeCollection
		);

		let results = aggregate(pipeline);

		if (Models['AddressPlace'] != null) {
			delete query.even;
			delete query.odd;

			const localResults = Models['AddressPlace'].aggregate(pipeline);

			if ((localResults != null ? localResults.length : undefined) > 0) {
				results = results.concat(localResults);
			}
		}

		for (let result of Array.from(results)) {
			if (
				(result.postalCode != null ? result.postalCode.length : undefined) === 1
			) {
				result.postalCode = result.postalCode[0];
			}
		}

		results = utils.unicodeSortArrayOfObjectsByParam(results, 'place');

		return results;
	}
});
