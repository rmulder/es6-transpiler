"use strict";

const assert = require("assert");
const is = require("simple-is");
const error = require("./../lib/error");
const core = require("./core");
const destructuring = require("./destructuring");



function getline(node) {
	return node.loc.start.line;
}

function isFunction(node) {
	return is.someof(node.type, ["FunctionDeclaration", "FunctionExpression"]);
}

function isObjectPattern(node) {
	return node && node.type == 'ObjectPattern';
}

function isArrayPattern(node) {
	return node && node.type == 'ArrayPattern';
}

var plugin = module.exports = {
	reset: function() {

	}

	, setup: function(src, changes, ast, options) {
		this.changes = changes;
		this.src = src;
		this.options = options;
	}

	, pre: function functionDestructuringAndDefaultsAndRest(node) {
		if ( isFunction(node) ) {
			const changes = this.changes;
			const src = this.src;
			const defaults = node.defaults;
			const params = node.params;
			let paramsCount = params.length;
			const initialParamsCount = paramsCount;
			const fnBodyRange = node.body.body.length ?
					node.body.body[0].range
					:
					[//empty function body. example: function r(){}
						node.body.range[0] + 1
						, node.body.range[1] - 1
					]
				;
			const indentStr = "" + src.substring(node.body.range[0] + 1, fnBodyRange[0]);
			const defaultsCount = defaults.length;
			const lastParam = params[paramsCount - 1];
			const lastDflt = defaults[defaults.length - 1];
			let hoistScope;

			paramsCount -= defaultsCount;

			if( paramsCount ) {
				for(let i = 0 ; i < paramsCount ; i++) {
					const param = params[i];
					const prevParam = params[i - 1];

					if( isObjectPattern(param) || isArrayPattern(param) ) {
						let paramStr, newVariables = [], newDefinitions = [], postFix = "";
						paramStr = "";//"\n" + indentStr;
						destructuring.unwrapDestructuring(param
							, {type: "Identifier", name: "arguments[" + i + "]"}
							, newVariables, newDefinitions);

						hoistScope = node.$scope.closestHoistScope();
						newVariables.forEach(function(newVariable, index){
							hoistScope.add(newVariable.name, newVariable.kind, param);
							core.allIdentifiers.add(newVariable.name);

							paramStr += (
								(index === 0 ? "var " : "")//always VAR !!! not a newVariable.type
									+ newVariable.name
									+ " = "
									+ newVariable.value
								);

							if( newVariable.needsToCleanUp ) {
								postFix += (newVariable.name + " = null;");
							}
						});
						paramStr += (";" + indentStr);

						paramStr = newDefinitions.reduce(this.__definitionToString, paramStr);
						paramStr += (";" + indentStr + postFix + indentStr);

						param.$replaced = true;

						// add default set
						changes.push({
							start: fnBodyRange[0],
							end: fnBodyRange[0],
							str: paramStr,
							type: 2// ??
						});

						// cleanup default definition
						// text change 'param = value' => ''
						changes.push({
							start: (prevParam ? prevParam.range[1] + 1 : param.range[0]) - (prevParam ? 1 : 0),
							end: param.range[1],
							str: ""
						});
					}
				}
			}

			if( defaultsCount ) {
				for(let i = 0 ; i < defaultsCount ; i++) {
					const paramIndex = initialParamsCount - defaultsCount + i;
					const param = params[paramIndex];
					const prevDflt = defaults[i - 1];
					const prevParam = params[paramIndex - 1];
					const dflt = defaults[i];

					if (dflt.type === "Identifier" && dflt.name === param.name) {
						error(getline(node), "function parameter '{0}' defined with default value refered to scope variable with the same name '{0}'", param.name);
					}

					let defaultStr;
					if( isObjectPattern(param) || isArrayPattern(param) ) {
						//dflt.$type = dflt.type;
						//dflt.type = "";//TODO:: check it

						let newVariables = [], newDefinitions = [], postFix = "";
						defaultStr = "";
						destructuring.unwrapDestructuring(param
							, {type: "Identifier", name: "arguments[" + paramIndex + "] !== void 0 ? arguments[" + paramIndex + "] : " + src.substring(dflt.range[0], dflt.range[1])}
							, newVariables, newDefinitions);

						hoistScope = node.$scope.closestHoistScope();
						newVariables.forEach(function(newVariable, index){
							hoistScope.add(newVariable.name, newVariable.kind, dflt);
							core.allIdentifiers.add(newVariable.name);

							defaultStr += (
								(index === 0 ? "var " : ", ")//always VAR !!! not a newVariable.type
									+ newVariable.name
									+ " = "
									+ newVariable.value
								);

							if( newVariable.needsToCleanUp ) {
								postFix += (newVariable.name + " = null;");
							}
						});
						defaultStr += (";" + indentStr);

						defaultStr = newDefinitions.reduce(this.__definitionToString, defaultStr);

						defaultStr += (";" + indentStr + postFix + indentStr);
					}
					else {
						defaultStr = "var " + param.name + " = arguments[" + paramIndex + "];if(" + param.name + " === void 0)" + param.name + " = " + src.substring(dflt.range[0], dflt.range[1]) + ";" + indentStr;
					}

					param.$replaced = true;

					// add default set
					changes.push({
						start: fnBodyRange[0],
						end: fnBodyRange[0],
						str: defaultStr,
						type: 2// ??
					});

					// cleanup default definition
					// text change 'param = value' => ''
					changes.push({
						start: ((prevDflt || prevParam) ? ((prevDflt || prevParam).range[1] + 1) : param.range[0]) - (prevParam ? 1 : 0),
						end: dflt.range[1],
						str: ""
					});
				}
			}

			const rest = node.rest;
			if( rest ) {
				const restStr = "var " + rest.name + " = [].slice.call(arguments, " + initialParamsCount + ");" + indentStr;
				if( !hoistScope ) {
					hoistScope = node.$scope.closestHoistScope();
				}

				hoistScope.add(rest.name, "var", rest, -1);

				// add rest
				changes.push({
					start: fnBodyRange[0],
					end: fnBodyRange[0],
					str: restStr
				});

				// cleanup rest definition
				changes.push({
					start: ((lastDflt || lastParam) ? ((lastDflt || lastParam).range[1] + 1) : rest.range[0]) - (lastParam ? 1 : 3),
					end: rest.range[1],
					str: ""
				});
			}
		}
	}

	/**
	 * use: reduce
	 */
	, __definitionToString: function(str, definition, index, a, b, c) {
		var definitionId = definition.id;
		assert(definitionId.type === "Identifier");

		return str + (
			(index === 0 ? "var " : ", ")//always VAR !!!
				+ definitionId.name
				+ " = "
				+ definition["init"]["object"].name
				+ core.PropertyToString(definition["init"]["property"])
			)
	}
};

for(let i in plugin) if( plugin.hasOwnProperty(i) && typeof plugin[i] === "function" ) {
	plugin[i] = plugin[i].bind(plugin);
}