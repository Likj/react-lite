import * as _ from './util'
import { renderComponent, clearDidMount } from './virtual-dom'

export let updateQueue = {
	updaters: [],
	isPending: false,
	add(updater) {
		/*
		 event bubbles from bottom-level to top-level
		 reverse the updater order can merge some props and state and reduce the refresh times
		 see Updater.update method below to know why
		*/
		this.updaters.splice(0, 0, updater)
	},
	batchUpdate() {
		this.isPending = true
		/*
		  each updater.update may add new updater to updateQueue
		  clear them with a loop
		*/
		while (this.updaters.length) {
			let { updaters } = this
			this.updaters = []
			_.eachItem(updaters, triggerUpdate)
		}
		this.isPending = false
	}
}
let triggerUpdate = updater => updater.update()

function Updater(instance) {
	this.instance = instance
	this.pendingStates = []
	this.pendingCallbacks = []
	this.isPending = false
	this.nextProps = this.nextContext = null
	this.clearCallbacks = this.clearCallbacks.bind(this)
}

Updater.prototype = {
	emitUpdate(nextProps, nextContext) {
		this.nextProps = nextProps
		this.nextContext = nextContext
		// receive nextProps!! should update immediately
		nextProps || !updateQueue.isPending
		? this.update()
		: updateQueue.add(this)
	},
	update() {
		let { instance, pendingStates, nextProps, nextContext } = this
		if (nextProps || pendingStates.length > 0) {
			nextProps = nextProps || instance.props
			nextContext = nextContext || instance.context
			this.nextProps = this.nextContext = null
			// merge the nextProps and nextState and update by one time
			shouldUpdate(instance, nextProps, this.getState(), nextContext, this.clearCallbacks)
		}
	},
	addState(nextState) {
		if (nextState) {
			this.pendingStates.push(nextState)
			if (!this.isPending) {
				this.emitUpdate()
			}
		}
	},
	replaceState(nextState) {
		let { pendingStates } = this
		pendingStates.pop()
		// push special params to point out should replace state
		pendingStates.push([nextState])
	},
	getState() {
		let { instance, pendingStates } = this
		let { state, props } = instance
		if (pendingStates.length) {
			state = _.extend({}, state)
			_.eachItem(pendingStates, nextState => {
				// replace state
				if (_.isArr(nextState)) {
					state = _.extend({}, nextState[0])
					return
				}
				if (_.isFn(nextState)) {
					nextState = nextState.call(instance, state, props)
				}
				_.extend(state, nextState)
			})
			pendingStates.length = 0
		}
		return state
	},
	clearCallbacks() {
		let { pendingCallbacks, instance } = this
		if (pendingCallbacks.length > 0) {
			_.eachItem(pendingCallbacks, callback => callback.call(instance))
			pendingCallbacks.length = 0
		}
	},
	addCallback(callback) {
		if (_.isFn(callback)) {
			this.pendingCallbacks.push(callback)
		}
	}
}

export default function Component(props, context) {
	this.$updater = new Updater(this)
	this.$cache = { isMounted: false }
	this.props = props
	this.state = {}
	this.refs = {}
	this.context = context || {}
}

let noop = _.noop
Component.prototype = {
	constructor: Component,
	getChildContext: noop,
	componentWillUpdate: noop,
	componentDidUpdate: noop,
	componentWillReceiveProps: noop,
	componentWillMount: noop,
	componentDidMount: noop,
	componentWillUnmount: noop,
	shouldComponentUpdate(nextProps, nextState) {
		return true
	},
	forceUpdate(callback) {
		let { $updater, $cache, props, state, context } = this
		if ($updater.isPending || !$cache.isMounted) {
			return
		}
		let nextProps = $cache.props || props
		let nextState = $cache.state || state
		let nextContext = $cache.context || {}
		let parentContext = $cache.parentContext
		let node = $cache.node
		let vtree = $cache.vtree
		// let map = $cache.parentVtree.map
		$cache.props = $cache.state = $cache.context = null
		$updater.isPending = true
		this.componentWillUpdate(nextProps, nextState, nextContext)
		this.state = nextState
		this.props = nextProps
		this.context = nextContext
		let nextVtree = renderComponent(this, parentContext)
		let newNode = vtree.updateTree(node, nextVtree, node.parentNode, nextVtree.context)
		if (newNode !== node) {
			newNode.map = newNode.map || new _.Map()
			_.eachItem(node.map.store, item => newNode.map.set(item[0], item[1]))
		}
		// if (newNode !== node) {
		// 	map.remove(node)
		// 	map.set(newNode, this)
		// }
		$cache.vtree = nextVtree
		$cache.node = newNode
		clearDidMount()
		this.componentDidUpdate(props, state, context)
		if (callback) {
			callback.call(this)
		}
		$updater.isPending = false
		$updater.emitUpdate()
	},
	setState(nextState, callback) {
		let { $updater } = this
		$updater.addCallback(callback)
		$updater.addState(nextState)
	},
	replaceState(nextState, callback) {
		let { $updater } = this
		$updater.addCallback(callback)
		$updater.replaceState(nextState)
	},
	getDOMNode() {
		let node = this.$cache.node
		return node && (node.tagName === 'NOSCRIPT') ? null : node
	},
	isMounted() {
		return this.$cache.isMounted
	}
}

export let updatePropsAndState = (component, props, state, context) => {
	component.state = state
	component.props = props
	component.context = context || {}
}

export let shouldUpdate = (component, nextProps, nextState, nextContext, callback) => {
	let shouldComponentUpdate = component.shouldComponentUpdate(nextProps, nextState, nextContext)
	if (shouldComponentUpdate === false) {
		updatePropsAndState(component, nextProps, nextState, nextContext)
		return
	}
	updatePropsAndState(component.$cache, nextProps, nextState, nextContext)
	component.forceUpdate(callback)
}
