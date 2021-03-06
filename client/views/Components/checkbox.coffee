class @Component.field.checkbox extends KonectyFieldComponent
	@register 'Component.field.checkbox'

	mixins: -> [
		new Mixin.Class []
		Mixin.Label
		Mixin.Name
		Mixin.Value
	]

	events: -> [
		"click label": -> @toggle()
	]

	setValue: (value) ->
		@toggle value

	getValue: ->
		return @value.get()

	toggle: (value) ->
		if value?
			@value.set value
		else
			@value.set not @value.curValue

		if @value.curValue is true
			@callFirstWith(@, 'addClass', 'active')
		else
			@callFirstWith(@, 'removeClass', 'active')

		@fireEvent('value-changed')