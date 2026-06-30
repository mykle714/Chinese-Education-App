import React from "react";
import ForeignText from "../../../components/ForeignText";
import { BreakdownLineItem, DefinitionColumn, DefinitionText } from "./styled";
import { stripParentheses } from "../../../utils/definitionUtils";

const BreakdownLineItemComponent: React.FC<{
    character: string;
    pinyin: string;
    definition: string;
    showPinyin?: boolean;
}> = ({ character, pinyin, definition, showPinyin = true }) => (
    <BreakdownLineItem className="mobile-demo-breakdown-item">
        <ForeignText
            size="sm"
            text={character}
            pronunciation={pinyin}
            showPinyin={showPinyin}
        />
        <DefinitionColumn className="mobile-demo-definition-column">
            <DefinitionText className="mobile-demo-definition-text">{stripParentheses(definition)}</DefinitionText>
        </DefinitionColumn>
    </BreakdownLineItem>
);

export default BreakdownLineItemComponent;
