<p  align="center">
		<img width="30%" responsive-image src="img/chss_logo_big.png" />
</p>

# CHSS: Code Highlighting Stylesheets

Is the syntax highlighting with regular VSCode themes not detailed enough?  
Did you ever wish you could use CSS to style your code yourself and assign colors and decorations to variables or functions with specific names?  
What if you could do this on a per-project basis in real-time?

Well, now you can. The CHSS extension hijacks VSCode's semantic highlighting to 

<p  align="center">
		<img width="80%" src="img/chss_demo_cropped.gif" />
</p>

## Installation
After installing the extension, simply create a file with the `.chss` extension in the root directory of any project and you're ready to go.  
The location of the file and some other behavior can be changed in the [extension's settings]()
## Compatibility
The decorations defined by this extension will override color and formatting provided by regular vscode themes. Personally, I recommend running this extension "on top" of a minimal, muted color theme for extra contrast with manually defined styles.  

As mentioned, CHSS works on semantic tokens provided by another language servers, so make sure your project is in a language that has a semantic highlighting capable syntax highlighting extension installed.
##  The CHSS Syntax
CHSS is basically vague bastardization of (S)CSS and .chss files use the highlighting for scss.  
This works out because style rules are internally converterted into [DecorationRenderOptions](https://code.visualstudio.com/api/references/vscode-api#DecorationRenderOptions) and most of the properties are css rules already.  

```scss
//CHSS supports single line comments.


  #window{
    color:red
  }
  

```

### Available CHSS Properties

>**Note:** All properties can be specified both in CSS style (`background-color`) and JS style (`backgroundColor`)

* **color**
* **opacity**
* **backgroundColor**
* **fontStyle**
* **fontWeight**
* **textDecoration**
* **letterSpacing**
* **cursor**
* **border**
* **borderColor**
* **borderRadius**
* **borderSpacing**
* **borderStyle**
* **borderWidth**
* **outline**
* **outlineColor**
* **outlineStyle**
* **outlineWidth**
* **gutterIconPath**
* **gutterIconSize**
* **isWholeLine**
* **overviewRulerLane**
* **overviewRulerColor**

A detailed description 

### color transformations (using Tinycolor)
(this functionality is "inspired" by my previosu extension [Semantic Rainbow]())
If you have worked with the css `filter` property this is basically how this works, except arguably more powerful because here you can control different color properties like background, text, border-color, etc separately.



>**Note:** There is as of yet no concept of relations between tokens, so features like sibling and descendant selectors in CSS, for use cases like "select variables in a class named x" or "select a variable x defined right after class y" are not possible. [For this we would need to parse an actual AST, too much work for now]

### Basic Selectors

| Selector        | Example       | Description                                     | Notes                                               |
| --------------- | ------------- | ----------------------------------------------- | --------------------------------------------------- |
| **name**        | `foo`         | select any type of token named 'foo'            |
| **#var**        | `#foo`        | Select any variable named 'foo'                 |                                                     |
| **.function**   | `.getFoo`     | Select any function with named 'getFoo'         |                                                     |
| **:modifier**   | `:readonly`   | select only tokens with the *readonly* modifier | Multiple `:` modifers can be chained.               |
| **[tokenType]** | `[parameter]` | select all semantic tokens of type "parameter"  | Semantic token names depend on the language server. |
### Combined selectors
Type and name selectors can be combined such as `Example[class]` and modifier selectors can be combined with any other type, for example `foo:readonly`, `.getFoo:async` and a combination of all three types is possible as well (`Example[class]:declaration`) as long as the order of *name -> type -> modifier* is preserved.


### Advanced Selectors

| Selector                  | Example                                       | Description                                                                                                      | Notes                                                                                                   |
| ------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **<wildcard*match>**      | `<foo*bar>`                                   | select any token starting with 'foo' and ending with 'bar'                                                       | Multiple wildcards are allowed                                                                          |
| **<^=start>**             | `<^=foo>`                                     | select any token starting with 'foo'                                                                             |                                                                                                         |
| **<$=end>**               | `<$=bar>`                                     | select any token ending with 'bar'                                                                               |                                                                                                         |
| **<*=include>**           | `<*=foo>`                                     | select any token which includes 'foo'                                                                            |                                                                                                         |
| **<"/regex/">**           | `<"/foo(bar)?/">`                             | select any token matching the regex /foo(bar)?/                                                                  | `<"/regex/i">` is supported for case insensitive matching                                               |
| **<*=match=type>**        | `<^=foo=variable>, <$=bar=function:readonly>` | select variables starting with 'foo' and functions ending with 'bar'.                                            | A regex match also needs to be prepended with `=` as in `<="/regex/"=type>` to work with type selectors |
| **selector::pseudoclass** | `foo::before, .getFoo::after`                 | style the 'before' pseudoclass of any token named foo and the 'after' pseudoclass of any function named 'getFoo' | Just as in regular CSS, pseudoclasses need `text-content`/`textContent` to be set.                      |


### Scoping
```scss

//The following section applies only to .js files in the workspace.
scope("**\*.js"){

  #window{
    color:red
  }
  
}

```

## Extension Settings
This extension has the following settings:

*  `chss.stylesheetLocation`:Path or glob pattern for your code stylesheet.
*  `chss.realtimeCHSS`:Apply style updates in real-time while editing the .chss file. Disable to only apply styles to the project once the .chss file is saved.
*  `chss.caseInsensitiveMatch`:Enable to make normal selectors such as `name` and `[*=name]` also match tokens named `Name` and `myName` respectively. Regex matches are not affected and still rely on the /i flag.

## Roadmap

## Credits